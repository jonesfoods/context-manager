/**
 * The storage surface autobio actually uses, as an interface.
 *
 * Today the only implementation is Chronicle's `JsStore`, and the conformance
 * check at the bottom of this file proves it still satisfies every method
 * here. The point is to let a plain database (SQLite, Postgres) implement the
 * same surface later, without autobio knowing the difference.
 *
 * Scope: the autobiographical strategy and the modules it depends on
 * (MessageStore, BlobManager, ContextLog, branch-generation, mint-preimage,
 * ContextManager's lifecycle). Other strategies are out of scope.
 *
 * Inventory (2026-10-29, at 9daf97a = v0.8.0 + fork): every JsStore method
 * called by those files, with the callers that use it. Chronicle's causal
 * tracking (causedBy / linkedTo on records) is not read by any of them.
 *
 *   state            registerState            autobio, message-store, context-log, mint-preimage
 *                    getStateJson              autobio, message-store, context-log
 *                    getStateJsonAt            message-store (ContextManager.getAt: time travel)
 *                    getStateItemJson          message-store, context-log
 *                    getStateLen               autobio, message-store, context-log
 *                    setStateJson              autobio
 *                    appendToStateJson         autobio, context-log
 *                    appendToStateJsonWithIdentity  autobio, message-store (uses returned id + sequence)
 *                    editStateItem             autobio, message-store, context-log
 *                    redactStateItems          autobio, message-store, context-log
 *                    compactState              autobio
 *   branches         currentBranch             autobio, message-store, context-manager, branch-generation
 *                    currentSequence           message-store, context-manager
 *                    createBranchAt            context-manager
 *                    switchBranch              context-manager
 *                    listBranches              context-manager
 *   blobs            storeBlob / getBlob       blob-manager, mint-preimage
 *   tree index       treeSet / treeGet         mint-preimage (requestHash -> blob)
 *   lifecycle        sync / close / isClosed   context-manager
 *
 * Token estimation is NOT a store concern: `estimateTokens` is MessageStore's
 * own method (with a pluggable estimator), not Chronicle's.
 *
 * Semantics a replacement must honour (from reading the callers):
 * - `sequence` is one store-wide, monotonically increasing number. Record ids
 *   and sequences returned by appends become MessageIds and message sequences,
 *   so they are durable identities, not row positions.
 * - every state read and write is relative to the current branch; branches
 *   fork at a sequence (createBranchAt) and see their parent's history up to it.
 * - `append_log` states are ordered lists edited by index (edit, redact,
 *   compact); `snapshot` states are a single JSON value replaced whole;
 *   `tree` states map a path to a blob reference.
 */
import type { JsStore } from '@animalabs/chronicle';

/** The part of a written record that callers read back. */
export interface StoreRecord {
  /** Durable record id. For message appends, this becomes the MessageId. */
  id: string;
  /** Store-wide monotonic sequence of the write. */
  sequence: number;
}

export interface StoreBranch {
  id: string;
  name: string;
  head: number;
  parentId?: string;
  branchPoint?: number;
  created: number;
}

export interface StateRegistration {
  id: string;
  strategy: 'append_log' | 'snapshot' | 'tree' | (string & {});
  deltaSnapshotEvery?: number;
  fullSnapshotEvery?: number;
  initialValue?: Buffer;
}

export interface TreeEntry {
  blobHash: string;
  size: number;
  mode: number;
}

/** Named JSON states on the current branch. */
export interface StateStore {
  registerState(registration: StateRegistration): void;
  getStateJson(stateId: string): any | null;
  getStateJsonAt(stateId: string, atSequence: number): any | null;
  getStateItemJson(stateId: string, index: number): any | null;
  getStateLen(stateId: string): number | null;
  setStateJson(stateId: string, value: any): StoreRecord;
  appendToStateJson(stateId: string, item: any): StoreRecord;
  appendToStateJsonWithIdentity(stateId: string, item: any, idField: string, sequenceField: string): StoreRecord;
  editStateItem(stateId: string, index: number, newValue: Buffer): StoreRecord;
  redactStateItems(stateId: string, start: number, end: number): StoreRecord;
  compactState(stateId: string): StoreRecord | null;
}

/** Rewind / resample / fork, at a sequence. */
export interface BranchStore {
  currentBranch(): StoreBranch;
  currentSequence(): number;
  createBranchAt(name: string, from: string, atSequence: number): StoreBranch;
  switchBranch(name: string): StoreBranch;
  listBranches(): StoreBranch[];
}

/** Content-addressed bytes (images, large tool results, mint preimages). */
export interface BlobStore {
  storeBlob(content: Buffer, contentType: string): string;
  getBlob(hash: string): Buffer | null;
}

/** Path -> blob reference. Only mint-preimage uses this; could become a plain state. */
export interface TreeIndexStore {
  treeSet(stateId: string, path: string, entry: TreeEntry): StoreRecord;
  treeGet(stateId: string, path: string): TreeEntry | null;
}

export interface StoreLifecycle {
  sync(): void;
  close(): void;
  isClosed(): boolean;
}

/** Everything autobio + its modules need from a store. */
export interface AutobioStore extends StateStore, BranchStore, BlobStore, TreeIndexStore, StoreLifecycle {}

// Conformance: Chronicle's JsStore must keep satisfying AutobioStore. If a
// Chronicle upgrade changes a signature we depend on, this line fails to compile.
type Conforms<T extends AutobioStore> = T;
export type ChronicleConformance = Conforms<JsStore>;
