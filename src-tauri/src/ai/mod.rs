//! AI チャット。同梱の原稿を根拠に、利用者の質問に答える。
//!
//! AI の種類に依らない部分（会話・ツール・原稿の写し・画面との型）をここに置き、
//! API に固有の部分は `claude/` に閉じる。ほかの AI を足すときは `ai/<名前>/` を足す。

pub mod claude;
pub mod conversation;
pub mod corpus;
pub mod key;
pub mod prompt;
pub mod tools;
pub mod turn;
pub mod types;

pub use conversation::AiState;
