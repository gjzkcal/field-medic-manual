//! 会話の状態。会話は 1 本だけで、保存しない（アプリを閉じたら消える）。
//!
//! API に送り返す履歴（thinking の署名・Web 検索の暗号化された結果を含む）は Rust に持ち、画面には渡さない。
//! 大きな結果を IPC で往復させないため。

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use serde_json::Value;
use tokio::sync::{oneshot, watch};

use crate::ai::corpus::Corpus;
use crate::ai::types::{AiEffort, AiModel, ClientToolResult};
use crate::error::AppError;
use crate::model::ModTarget;

/// 会話の最初に決めて、途中では変えないもの。thinking の署名が system・tools に結び付くため。
#[derive(Debug, Clone)]
pub struct Fixed {
    pub model: AiModel,
    pub effort: AiEffort,
    pub mods: Vec<ModTarget>,
    pub corpus: Arc<Corpus>,
    pub system: Arc<String>,
    /// 組織の設定で Web 検索が切られていたら、最初の質問で false にする（まだ何も答えていないので tools を変えてよい）
    pub web_search: bool,
}

#[derive(Debug, Clone)]
struct Conversation {
    fixed: Fixed,
    messages: Vec<Value>,
    /// 各質問の user メッセージの位置。編集のときに、ここで後ろを切る
    turn_starts: Vec<usize>,
}

struct Active {
    id: u64,
    cancel: watch::Sender<bool>,
    pending: HashMap<String, oneshot::Sender<ClientToolResult>>,
}

#[derive(Default)]
struct Inner {
    conversation: Option<Conversation>,
    /// 会話を消すたびに増やす。消した後に終わった回答を、新しい会話に書き込まないため
    generation: u64,
    next_turn_id: u64,
    active: Option<Active>,
}

#[derive(Default)]
pub struct AiState {
    inner: Mutex<Inner>,
}

/// 回答を始めるときに渡す写し。
pub struct TurnStart {
    pub fixed: Fixed,
    pub messages: Vec<Value>,
    pub cancel: watch::Receiver<bool>,
    pub guard: TurnGuard,
}

impl AiState {
    fn lock(&self) -> Result<MutexGuard<'_, Inner>, AppError> {
        self.inner
            .lock()
            .map_err(|_| AppError::Internal("会話の状態が壊れています".to_owned()))
    }

    /// 会話があるか（あれば、原稿を読み直さずに済む）。
    ///
    /// # Errors
    ///
    /// 状態が壊れているとき。
    pub fn has_conversation(&self) -> Result<bool, AppError> {
        Ok(self.lock()?.conversation.is_some())
    }

    /// 回答を始める。会話がなければ `fixed` で始める。
    ///
    /// # Errors
    ///
    /// 回答中なら `InvalidInput`。`replace_from` が範囲外なら `InvalidInput`。会話がなく `fixed` もないとき `Internal`。
    pub fn begin(
        self: &Arc<Self>,
        fixed: Option<Fixed>,
        replace_from: Option<u32>,
    ) -> Result<TurnStart, AppError> {
        let mut inner = self.lock()?;
        if inner.active.is_some() {
            return Err(AppError::InvalidInput(
                "回答の途中です。終わるか止めてから送ってください".to_owned(),
            ));
        }
        if inner.conversation.is_none() {
            let fixed =
                fixed.ok_or_else(|| AppError::Internal("会話の設定がありません".to_owned()))?;
            inner.conversation = Some(Conversation {
                fixed,
                messages: Vec::new(),
                turn_starts: Vec::new(),
            });
        }
        let Some(conversation) = inner.conversation.as_ref() else {
            return Err(AppError::Internal("会話を始められません".to_owned()));
        };
        let (messages, base_turns) = match replace_from {
            None => (
                conversation.messages.clone(),
                conversation.turn_starts.len(),
            ),
            Some(index) => {
                let index = usize::try_from(index).unwrap_or(usize::MAX);
                let Some(&cut) = conversation.turn_starts.get(index) else {
                    return Err(AppError::InvalidInput(
                        "編集する質問が見つかりません".to_owned(),
                    ));
                };
                (conversation.messages[..cut].to_vec(), index)
            }
        };
        let fixed = conversation.fixed.clone();
        let (cancel_tx, cancel_rx) = watch::channel(false);
        inner.next_turn_id += 1;
        let id = inner.next_turn_id;
        inner.active = Some(Active {
            id,
            cancel: cancel_tx,
            pending: HashMap::new(),
        });
        Ok(TurnStart {
            fixed,
            messages,
            cancel: cancel_rx,
            guard: TurnGuard {
                state: Arc::clone(self),
                id,
                generation: inner.generation,
                base_turns,
                done: false,
            },
        })
    }

    /// 回答を止める。止めた回答は会話に残らない。
    ///
    /// # Errors
    ///
    /// 状態が壊れているとき。
    pub fn cancel(&self) -> Result<(), AppError> {
        if let Some(active) = self.lock()?.active.as_mut() {
            let _ = active.cancel.send(true);
            // 待っている聞き返しも止める（送り手を落とすと、待っている側に届く）
            active.pending.clear();
        }
        Ok(())
    }

    /// 会話を消す。回答中なら止める。
    ///
    /// # Errors
    ///
    /// 状態が壊れているとき。
    pub fn reset(&self) -> Result<(), AppError> {
        let mut inner = self.lock()?;
        inner.generation += 1;
        inner.conversation = None;
        if let Some(active) = inner.active.as_mut() {
            let _ = active.cancel.send(true);
            active.pending.clear();
        }
        Ok(())
    }

    /// 画面で答えてもらう要求を登録し、答えを受け取る口を返す。
    pub(crate) fn register_pending(
        &self,
        turn_id: u64,
        tool_use_id: &str,
    ) -> Result<oneshot::Receiver<ClientToolResult>, AppError> {
        let mut inner = self.lock()?;
        let active = inner
            .active
            .as_mut()
            .filter(|a| a.id == turn_id)
            .ok_or_else(|| AppError::InvalidInput("回答は止められました".to_owned()))?;
        let (tx, rx) = oneshot::channel();
        active.pending.insert(tool_use_id.to_owned(), tx);
        Ok(rx)
    }

    /// 画面からの答えを、待っている回答に渡す。
    ///
    /// # Errors
    ///
    /// 待っている要求がなければ `NotFound`。
    pub fn resolve_pending(
        &self,
        tool_use_id: &str,
        result: ClientToolResult,
    ) -> Result<(), AppError> {
        let sender = self
            .lock()?
            .active
            .as_mut()
            .and_then(|a| a.pending.remove(tool_use_id))
            .ok_or_else(|| AppError::NotFound(format!("答えを待っている質問 {tool_use_id}")))?;
        sender
            .send(result)
            .map_err(|_| AppError::InvalidInput("回答は止められました".to_owned()))
    }
}

/// 回答中であることを表す。`commit` しないまま落とすと、回答は会話に残らない（失敗・キャンセルの巻き戻し）。
pub struct TurnGuard {
    state: Arc<AiState>,
    id: u64,
    generation: u64,
    /// 会話に残す質問の数（編集なら、編集した質問より前の数）
    base_turns: usize,
    done: bool,
}

impl TurnGuard {
    #[must_use]
    pub const fn turn_id(&self) -> u64 {
        self.id
    }

    /// 回答を会話に残す。返すのはこの質問の番号。会話が消されていたら None。
    ///
    /// # Errors
    ///
    /// 状態が壊れているとき。
    pub fn commit(
        mut self,
        messages: Vec<Value>,
        start: usize,
        web_search: bool,
    ) -> Result<Option<u32>, AppError> {
        self.done = true;
        let mut inner = self.state.lock()?;
        let current = inner.active.as_ref().is_some_and(|a| a.id == self.id);
        if current {
            inner.active = None;
        }
        if !current || inner.generation != self.generation {
            return Ok(None);
        }
        let Some(conversation) = inner.conversation.as_mut() else {
            return Ok(None);
        };
        conversation.messages = messages;
        conversation.turn_starts.truncate(self.base_turns);
        conversation.turn_starts.push(start);
        conversation.fixed.web_search = web_search;
        Ok(u32::try_from(conversation.turn_starts.len() - 1).ok())
    }
}

impl Drop for TurnGuard {
    fn drop(&mut self) {
        if self.done {
            return;
        }
        if let Ok(mut inner) = self.state.inner.lock()
            && inner.active.as_ref().is_some_and(|a| a.id == self.id)
        {
            inner.active = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::ai::corpus::fixtures;

    fn fixed() -> Fixed {
        Fixed {
            model: AiModel::ClaudeSonnet55,
            effort: AiEffort::Medium,
            mods: Vec::new(),
            corpus: Arc::new(fixtures::corpus()),
            system: Arc::new("sys".to_owned()),
            web_search: true,
        }
    }

    fn answer(state: &Arc<AiState>, replace_from: Option<u32>, text: &str) -> Option<u32> {
        let start = state
            .begin(Some(fixed()), replace_from)
            .expect("始められる");
        let mut messages = start.messages;
        let at = messages.len();
        messages.push(json!({"role": "user", "content": text}));
        messages.push(json!({"role": "assistant", "content": "ok"}));
        start.guard.commit(messages, at, true).expect("残せる")
    }

    #[test]
    fn turns_are_appended_and_numbered() {
        let state = Arc::new(AiState::default());
        assert_eq!(answer(&state, None, "1"), Some(0));
        assert_eq!(answer(&state, None, "2"), Some(1));
        let start = state.begin(None, None).expect("始められる");
        assert_eq!(start.messages.len(), 4);
    }

    #[test]
    fn editing_cuts_the_history_at_the_question() {
        let state = Arc::new(AiState::default());
        answer(&state, None, "1");
        answer(&state, None, "2");
        answer(&state, None, "3");
        assert_eq!(answer(&state, Some(1), "2b"), Some(1));
        let start = state.begin(None, None).expect("始められる");
        let texts: Vec<&Value> = start.messages.iter().map(|m| &m["content"]).collect();
        assert_eq!(
            texts,
            vec![&json!("1"), &json!("ok"), &json!("2b"), &json!("ok")]
        );
        drop(start);
        assert!(matches!(
            state.begin(None, Some(5)),
            Err(AppError::InvalidInput(_))
        ));
    }

    #[test]
    fn dropped_turn_leaves_the_conversation_unchanged() {
        let state = Arc::new(AiState::default());
        answer(&state, None, "1");
        let start = state.begin(None, Some(0)).expect("始められる");
        drop(start);
        let again = state.begin(None, None).expect("終わった後は始められる");
        assert_eq!(again.messages.len(), 2, "失敗した編集は元の会話を変えない");
    }

    #[test]
    fn only_one_turn_at_a_time() {
        let state = Arc::new(AiState::default());
        let _start = state.begin(Some(fixed()), None).expect("始められる");
        assert!(matches!(
            state.begin(None, None),
            Err(AppError::InvalidInput(_))
        ));
    }

    #[test]
    fn reset_discards_a_turn_in_progress() {
        let state = Arc::new(AiState::default());
        let start = state.begin(Some(fixed()), None).expect("始められる");
        let cancel = start.cancel.clone();
        state.reset().expect("消せる");
        assert!(*cancel.borrow());
        assert_eq!(
            start
                .guard
                .commit(vec![json!({})], 0, true)
                .expect("呼べる"),
            None
        );
        assert!(!state.has_conversation().expect("読める"));
    }

    #[test]
    fn pending_answers_reach_the_waiting_turn() {
        let state = Arc::new(AiState::default());
        let start = state.begin(Some(fixed()), None).expect("始められる");
        let mut rx = state
            .register_pending(start.guard.turn_id(), "t1")
            .expect("登録できる");
        state
            .resolve_pending(
                "t1",
                ClientToolResult::AskUser {
                    answer: "ある".to_owned(),
                },
            )
            .expect("渡せる");
        assert!(
            matches!(rx.try_recv(), Ok(ClientToolResult::AskUser { answer }) if answer == "ある")
        );
        assert!(matches!(
            state.resolve_pending(
                "t1",
                ClientToolResult::AskUser {
                    answer: String::new()
                }
            ),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn cancel_drops_pending_requests() {
        let state = Arc::new(AiState::default());
        let start = state.begin(Some(fixed()), None).expect("始められる");
        let mut rx = state
            .register_pending(start.guard.turn_id(), "t1")
            .expect("登録できる");
        state.cancel().expect("止められる");
        assert!(rx.try_recv().is_err());
    }
}
