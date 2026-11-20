import {
  BOARD_SIZE,
  breakWallAt,
  confirmWallGo2BreakWall,
  getRemainingPlacementKinds,
  isInBounds,
  isSameWallEdge,
  isValidWallEdge,
  movePiece,
  placeWall,
  selectPiece,
  selectWallGo2BreakDestination,
  toggleWallBreak,
  wallKey,
} from '../engine';
import type {
  AIDifficulty,
  CellPos,
  GameState,
  PieceKind,
  RngFn,
  WallEdge,
} from '../engine';
import {
  analyzeComponentsFast,
  createEvalScratch,
  createSearchBoard,
  decodeWallCode,
  evaluateOpeningPlacementCell,
  evaluateSearchBoard,
  evaluateSearchBoardAll,
  findPlayerIndex,
  genOpenAdjacentWallsFast,
  genWallGo1DestsFast,
  genWallGo2NormalDestsFast,
  getWallByCode,
  makeCompactAction,
  nowMs,
  safeRng,
  setWallByCode,
  shouldAutoSkipPlayerFast,
  unmakeCompactAction,
  wallCodeBetween,
} from './evaluate';
import type { CompactAction, EvalScratch, SearchBoard } from './evaluate';

export interface BotPlacementAction {
  row: number;
  col: number;
  kind: PieceKind;
}

export interface BotTurnAction {
  pieceId: string;
  useWallBreak: boolean;
  breakWall: WallEdge | null;
  destination: CellPos;
  placeWall: WallEdge;
}

const DR: readonly number[] = [-1, 1, 0, 0];
const DC: readonly number[] = [0, 0, -1, 1];

const HARD_DEADLINE_MS = 145;
const HARD_BEAM_TOTAL = 12;
const HARD_BEAM_NORMAL_CAP = 9;
const HARD_BEAM_BREAK_CAP = 3;
const CLEAR_WIN_THRESHOLD = 10000;
const TIE_EPS = 0.05;
const NORMAL_PLACEMENT_WINDOW = 0.75;
const EASY_TEMPERATURE = 45.0;
const EASY_BREAK_MIX_PROB = 0.08;

interface ScoredAction {
  action: CompactAction;
  ply1Score: number;
  isTerminal: boolean;
  order: number;
}

function assertTransition(prev: GameState, next: GameState, step: string): GameState {
  if (next === prev) {
    throw new Error(`applyBotTurnAction failed at "${step}": engine returned no-op`);
  }
  return next;
}

function pickIndex(len: number, rng: RngFn): number {
  const idx = Math.floor(safeRng(rng) * len);
  if (idx < 0) {
    return 0;
  }
  if (idx >= len) {
    return len - 1;
  }
  return idx;
}

function pickWeightedIndex(weights: readonly number[], rng: RngFn): number {
  let total = 0;
  for (let i = 0; i < weights.length; i++) {
    total += weights[i];
  }
  if (!(total > 0)) {
    return pickIndex(weights.length, rng);
  }
  const target = safeRng(rng) * total;
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (target < acc) {
      return i;
    }
  }
  return weights.length - 1;
}

function compactToBotAction(board: SearchBoard, action: CompactAction): BotTurnAction {
  return {
    pieceId: board.pieceIds[action.pieceIdx],
    useWallBreak: action.useWallBreak,
    breakWall: action.breakWallCode === -1 ? null : decodeWallCode(action.breakWallCode),
    destination: { row: action.destRow, col: action.destCol },
    placeWall: decodeWallCode(action.placeWallCode),
  };
}

function enumerateNormalActionsFast(
  board: SearchBoard,
  actorIdx: number,
  scratch: EvalScratch,
  out: CompactAction[],
): void {
  const pieceCount = board.pieceCount;
  const pieceOwner = board.pieceOwner;
  const destBuf = scratch.destBuf;
  const wallBuf = scratch.wallBuf;

  for (let pIdx = 0; pIdx < pieceCount; pIdx++) {
    if (pieceOwner[pIdx] !== actorIdx) {
      continue;
    }
    const r0 = board.pieceRow[pIdx];
    const c0 = board.pieceCol[pIdx];
    const destCount =
      board.ruleVariant === 0
        ? genWallGo1DestsFast(board, r0, c0, scratch)
        : genWallGo2NormalDestsFast(board, pIdx, scratch);

    for (let d = 0; d < destCount; d++) {
      const cell = destBuf[d];
      const destRow = (cell / BOARD_SIZE) | 0;
      const destCol = cell - destRow * BOARD_SIZE;
      const wallCount = genOpenAdjacentWallsFast(board, destRow, destCol, wallBuf);
      for (let w = 0; w < wallCount; w++) {
        out.push({
          pieceIdx: pIdx,
          useWallBreak: false,
          breakWallCode: -1,
          destRow,
          destCol,
          placeWallCode: wallBuf[w],
        });
      }
    }
  }
}

function pushWallGo2BreakActionsForPath(
  board: SearchBoard,
  pIdx: number,
  destRow: number,
  destCol: number,
  breakWallCode: number,
  scratch: EvalScratch,
  out: CompactAction[],
): void {
  // Temporarily clear broken wall so E10 resealing is included when adjacent to dest
  setWallByCode(board, breakWallCode, 0);
  const wallBuf = scratch.wallBuf;
  const wallCount = genOpenAdjacentWallsFast(board, destRow, destCol, wallBuf);
  for (let w = 0; w < wallCount; w++) {
    out.push({
      pieceIdx: pIdx,
      useWallBreak: true,
      breakWallCode,
      destRow,
      destCol,
      placeWallCode: wallBuf[w],
    });
  }
  setWallByCode(board, breakWallCode, 1);
}

function enumerateBreakActionsFast(
  board: SearchBoard,
  actorIdx: number,
  scratch: EvalScratch,
  out: CompactAction[],
): void {
  if (!board.is3P || board.wallBreaksRemaining[actorIdx] <= 0) {
    return;
  }

  const pieceCount = board.pieceCount;
  const pieceOwner = board.pieceOwner;
  const destBuf = scratch.destBuf;
  const wallBuf = scratch.wallBuf;
  const cellPiece = board.cellPiece;

  if (board.ruleVariant === 0) {
    // Wall Go I: break an adjacent existing wall passing E08 non-soft-lock filter
    for (let pIdx = 0; pIdx < pieceCount; pIdx++) {
      if (pieceOwner[pIdx] !== actorIdx) {
        continue;
      }
      const r0 = board.pieceRow[pIdx];
      const c0 = board.pieceCol[pIdx];

      for (let dir = 0; dir < 4; dir++) {
        const nr = r0 + DR[dir];
        const nc = c0 + DC[dir];
        if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) {
          continue;
        }
        const bwCode = wallCodeBetween(r0, c0, nr, nc);
        if (getWallByCode(board, bwCode) === 0) {
          continue;
        }

        setWallByCode(board, bwCode, 0);
        // genWallGo1DestsFast returns 0 if |D_1'| === 0 (exact E08 soft-lock filter)
        // and includes origin stay (E07) when |D_1'| >= 1.
        const destCount = genWallGo1DestsFast(board, r0, c0, scratch);
        for (let d = 0; d < destCount; d++) {
          const cell = destBuf[d];
          const destRow = (cell / BOARD_SIZE) | 0;
          const destCol = cell - destRow * BOARD_SIZE;
          const wallCount = genOpenAdjacentWallsFast(board, destRow, destCol, wallBuf);
          for (let w = 0; w < wallCount; w++) {
            out.push({
              pieceIdx: pIdx,
              useWallBreak: true,
              breakWallCode: bwCode,
              destRow,
              destCol,
              placeWallCode: wallBuf[w],
            });
          }
        }
        setWallByCode(board, bwCode, 1);
      }
    }
    return;
  }

  // Wall Go II: path-through exact-1-wall breaks (includes E13 ambiguous diagonals & E14 smash)
  for (let pIdx = 0; pIdx < pieceCount; pIdx++) {
    if (pieceOwner[pIdx] !== actorIdx) {
      continue;
    }
    const kind = board.pieceKind[pIdx];
    if (kind !== 1 && kind !== 2) {
      continue;
    }
    const r0 = board.pieceRow[pIdx];
    const c0 = board.pieceCol[pIdx];

    if (kind === 1) {
      // 'square': straight orthogonal 1-2 steps
      for (let dir = 0; dir < 4; dir++) {
        const dr = DR[dir];
        const dc = DC[dir];
        const r1 = r0 + dr;
        const c1 = c0 + dc;
        if (r1 < 0 || r1 >= BOARD_SIZE || c1 < 0 || c1 >= BOARD_SIZE) {
          continue;
        }
        if (cellPiece[r1 * BOARD_SIZE + c1] !== -1) {
          continue;
        }
        const e1 = wallCodeBetween(r0, c0, r1, c1);
        const w1 = getWallByCode(board, e1);
        if (w1 === 1) {
          pushWallGo2BreakActionsForPath(board, pIdx, r1, c1, e1, scratch, out);
        }

        const r2 = r1 + dr;
        const c2 = c1 + dc;
        if (r2 < 0 || r2 >= BOARD_SIZE || c2 < 0 || c2 >= BOARD_SIZE) {
          continue;
        }
        if (cellPiece[r2 * BOARD_SIZE + c2] !== -1) {
          continue;
        }
        const e2 = wallCodeBetween(r1, c1, r2, c2);
        const w2 = getWallByCode(board, e2);
        if (w1 + w2 === 1) {
          const breakCode = w1 === 1 ? e1 : e2;
          pushWallGo2BreakActionsForPath(board, pIdx, r2, c2, breakCode, scratch, out);
        }
      }
    } else {
      // 'round': orthogonal 1 step or 1 step + 90-degree turn + 1 step
      for (let dir = 0; dir < 4; dir++) {
        const dr1 = DR[dir];
        const dc1 = DC[dir];
        const r1 = r0 + dr1;
        const c1 = c0 + dc1;
        if (r1 < 0 || r1 >= BOARD_SIZE || c1 < 0 || c1 >= BOARD_SIZE) {
          continue;
        }
        if (cellPiece[r1 * BOARD_SIZE + c1] !== -1) {
          continue;
        }
        const e1 = wallCodeBetween(r0, c0, r1, c1);
        const w1 = getWallByCode(board, e1);
        if (w1 === 1) {
          pushWallGo2BreakActionsForPath(board, pIdx, r1, c1, e1, scratch, out);
        }

        for (let t = 0; t < 2; t++) {
          const dr2 = t === 0 ? dc1 : -dc1;
          const dc2 = t === 0 ? dr1 : -dr1;
          const r2 = r1 + dr2;
          const c2 = c1 + dc2;
          if (r2 < 0 || r2 >= BOARD_SIZE || c2 < 0 || c2 >= BOARD_SIZE) {
            continue;
          }
          if (cellPiece[r2 * BOARD_SIZE + c2] !== -1) {
            continue;
          }
          const e2 = wallCodeBetween(r1, c1, r2, c2);
          const w2 = getWallByCode(board, e2);
          if (w1 + w2 === 1) {
            const breakCode = w1 === 1 ? e1 : e2;
            pushWallGo2BreakActionsForPath(board, pIdx, r2, c2, breakCode, scratch, out);
          }
        }
      }
    }
  }
}

function choosePlacementKind(
  state: GameState,
  playerId: number,
  row: number,
  col: number,
  difficulty: AIDifficulty,
  rng: RngFn,
): PieceKind {
  if (state.ruleVariant === 'wallgo1') {
    return 'standard';
  }
  const remaining = getRemainingPlacementKinds(state, playerId);
  if (remaining.length === 0) {
    throw new Error(
      `chooseAiPlacement: no remaining placement kinds for player ${playerId}`,
    );
  }
  if (remaining.length === 1) {
    return remaining[0];
  }
  if (difficulty === 'easy') {
    return safeRng(rng) < 0.5 ? remaining[0] : remaining[1];
  }

  // On 3P Wall Go II 1st placement, prefer 'round' when an opponent is diagonally adjacent
  // to exert immediate 90-degree L-turn containment; otherwise prefer 'square' for axial reach.
  let hasDiagonalOpp = false;
  for (let i = 0; i < state.pieces.length; i++) {
    const p = state.pieces[i];
    if (
      p.ownerId !== playerId &&
      Math.abs(p.row - row) === 1 &&
      Math.abs(p.col - col) === 1
    ) {
      hasDiagonalOpp = true;
      break;
    }
  }
  return hasDiagonalOpp ? 'round' : 'square';
}

/**
 * Selects an initial placement action during `phase === 'placement'` (F21).
 * Never mutates `state`.
 */
export function chooseAiPlacement(
  state: GameState,
  difficulty: AIDifficulty,
  rng: RngFn = Math.random,
): BotPlacementAction {
  if (state.phase !== 'placement') {
    throw new Error(
      `chooseAiPlacement requires phase "placement", received "${state.phase}"`,
    );
  }
  if (state.placementStep < 0 || state.placementStep >= state.placementQueue.length) {
    throw new Error(
      `chooseAiPlacement: invalid placementStep ${state.placementStep}`,
    );
  }
  const playerId = state.placementQueue[state.placementStep];
  const actor = state.players[playerId];
  if (!actor) {
    throw new Error(`chooseAiPlacement: invalid placement playerId ${playerId}`);
  }

  const occupied = new Uint8Array(BOARD_SIZE * BOARD_SIZE);
  for (let i = 0; i < state.pieces.length; i++) {
    const p = state.pieces[i];
    if (isInBounds(p.row, p.col)) {
      occupied[p.row * BOARD_SIZE + p.col] = 1;
    }
  }

  const candidates: { row: number; col: number; score: number }[] = [];
  let bestScore = -Infinity;

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (occupied[r * BOARD_SIZE + c] !== 0) {
        continue;
      }
      const score = evaluateOpeningPlacementCell(state, playerId, r, c);
      candidates.push({ row: r, col: c, score });
      if (score > bestScore) {
        bestScore = score;
      }
    }
  }

  if (candidates.length === 0) {
    throw new Error('chooseAiPlacement: no empty cells available on the board');
  }

  let chosen: { row: number; col: number; score: number };

  if (difficulty === 'easy') {
    const weights: number[] = new Array<number>(candidates.length);
    for (let i = 0; i < candidates.length; i++) {
      const w = candidates[i].score + 6.0;
      weights[i] = w > 0.5 ? w : 0.5;
    }
    chosen = candidates[pickWeightedIndex(weights, rng)];
  } else if (difficulty === 'normal') {
    // Strictly <= 0.75 pts of best score so empty board picks ONLY within {C3, E3, C5, E5, D4}
    const threshold = bestScore - NORMAL_PLACEMENT_WINDOW;
    const pool: { row: number; col: number; score: number }[] = [];
    for (let i = 0; i < candidates.length; i++) {
      if (candidates[i].score >= threshold) {
        pool.push(candidates[i]);
      }
    }
    chosen = pool[pickIndex(pool.length, rng)];
  } else {
    const threshold = bestScore - 1e-6;
    const pool: { row: number; col: number; score: number }[] = [];
    for (let i = 0; i < candidates.length; i++) {
      if (candidates[i].score >= threshold) {
        pool.push(candidates[i]);
      }
    }
    chosen = pool[pickIndex(pool.length, rng)];
  }

  const kind = choosePlacementKind(
    state,
    playerId,
    chosen.row,
    chosen.col,
    difficulty,
    rng,
  );

  return {
    row: chosen.row,
    col: chosen.col,
    kind,
  };
}

function chooseEasyTurn(
  board: SearchBoard,
  actorIdx: number,
  normalActions: CompactAction[],
  breakActions: CompactAction[],
  scratch: EvalScratch,
  rng: RngFn,
): CompactAction {
  let pool: CompactAction[];
  if (normalActions.length === 0) {
    pool = breakActions;
  } else if (breakActions.length > 0 && safeRng(rng) < EASY_BREAK_MIX_PROB) {
    pool = normalActions.concat(breakActions);
  } else {
    pool = normalActions;
  }

  const scores: number[] = new Array<number>(pool.length);
  let maxScore = -Infinity;

  for (let i = 0; i < pool.length; i++) {
    const act = pool[i];
    const origCell = makeCompactAction(board, actorIdx, act);
    const ev = evaluateSearchBoard(board, actorIdx, scratch).score;
    unmakeCompactAction(board, actorIdx, act, origCell);
    scores[i] = ev;
    if (ev > maxScore) {
      maxScore = ev;
    }
  }

  const weights: number[] = new Array<number>(pool.length);
  for (let i = 0; i < pool.length; i++) {
    const diff = (scores[i] - maxScore) / EASY_TEMPERATURE;
    weights[i] = Math.exp(diff < -5.0 ? -5.0 : diff);
  }

  return pool[pickWeightedIndex(weights, rng)];
}

function chooseNormalTurn(
  board: SearchBoard,
  actorIdx: number,
  normalActions: CompactAction[],
  breakActions: CompactAction[],
  scratch: EvalScratch,
  rng: RngFn,
): CompactAction {
  const allActions =
    breakActions.length === 0
      ? normalActions
      : normalActions.length === 0
        ? breakActions
        : normalActions.concat(breakActions);

  const scores: number[] = new Array<number>(allActions.length);
  let bestScore = -Infinity;

  for (let i = 0; i < allActions.length; i++) {
    const act = allActions[i];
    const origCell = makeCompactAction(board, actorIdx, act);
    const ev = evaluateSearchBoard(board, actorIdx, scratch).score;
    unmakeCompactAction(board, actorIdx, act, origCell);
    scores[i] = ev;
    if (ev > bestScore) {
      bestScore = ev;
    }
  }

  const threshold = bestScore - TIE_EPS;
  const bestCandidates: CompactAction[] = [];
  for (let i = 0; i < allActions.length; i++) {
    if (scores[i] >= threshold) {
      bestCandidates.push(allActions[i]);
    }
  }

  return bestCandidates[pickIndex(bestCandidates.length, rng)];
}

function compareScoredDesc(a: ScoredAction, b: ScoredAction): number {
  if (b.ply1Score !== a.ply1Score) {
    return b.ply1Score - a.ply1Score;
  }
  return a.order - b.order;
}

function buildHardBeam(
  normalScored: ScoredAction[],
  breakScored: ScoredAction[],
): ScoredAction[] {
  normalScored.sort(compareScoredDesc);
  breakScored.sort(compareScoredDesc);

  if (normalScored.length === 0) {
    return breakScored.slice(0, HARD_BEAM_TOTAL);
  }
  if (breakScored.length === 0) {
    return normalScored.slice(0, HARD_BEAM_TOTAL);
  }

  const takeNormal =
    normalScored.length < HARD_BEAM_NORMAL_CAP
      ? normalScored.length
      : HARD_BEAM_NORMAL_CAP;
  const takeBreak =
    breakScored.length < HARD_BEAM_BREAK_CAP ? breakScored.length : HARD_BEAM_BREAK_CAP;

  const beam: ScoredAction[] = [];
  for (let i = 0; i < takeNormal; i++) {
    beam.push(normalScored[i]);
  }
  for (let i = 0; i < takeBreak; i++) {
    beam.push(breakScored[i]);
  }

  let nIdx = takeNormal;
  let bIdx = takeBreak;
  while (
    beam.length < HARD_BEAM_TOTAL &&
    (nIdx < normalScored.length || bIdx < breakScored.length)
  ) {
    if (nIdx >= normalScored.length) {
      beam.push(breakScored[bIdx++]);
    } else if (bIdx >= breakScored.length) {
      beam.push(normalScored[nIdx++]);
    } else if (compareScoredDesc(normalScored[nIdx], breakScored[bIdx]) <= 0) {
      beam.push(normalScored[nIdx++]);
    } else {
      beam.push(breakScored[bIdx++]);
    }
  }

  beam.sort(compareScoredDesc);
  return beam;
}

function chooseHardTurn(
  board: SearchBoard,
  actorIdx: number,
  normalActions: CompactAction[],
  breakActions: CompactAction[],
  scratch: EvalScratch,
  rng: RngFn,
): CompactAction {
  const deadlineMs = nowMs() + HARD_DEADLINE_MS;

  // Phase 1: Full 1-ply screening over ALL normal and Wall Break actions
  const normalScored: ScoredAction[] = new Array<ScoredAction>(normalActions.length);
  const breakScored: ScoredAction[] = new Array<ScoredAction>(breakActions.length);
  let orderCounter = 0;
  let bestImmediateWinScore = -Infinity;

  for (let i = 0; i < normalActions.length; i++) {
    const act = normalActions[i];
    const origCell = makeCompactAction(board, actorIdx, act);
    const res = evaluateSearchBoard(board, actorIdx, scratch);
    unmakeCompactAction(board, actorIdx, act, origCell);
    normalScored[i] = {
      action: act,
      ply1Score: res.score,
      isTerminal: res.isTerminal,
      order: orderCounter++,
    };
    if (res.isTerminal && res.score >= CLEAR_WIN_THRESHOLD && res.score > bestImmediateWinScore) {
      bestImmediateWinScore = res.score;
    }
  }

  for (let i = 0; i < breakActions.length; i++) {
    const act = breakActions[i];
    const origCell = makeCompactAction(board, actorIdx, act);
    const res = evaluateSearchBoard(board, actorIdx, scratch);
    unmakeCompactAction(board, actorIdx, act, origCell);
    breakScored[i] = {
      action: act,
      ply1Score: res.score,
      isTerminal: res.isTerminal,
      order: orderCounter++,
    };
    if (res.isTerminal && res.score >= CLEAR_WIN_THRESHOLD && res.score > bestImmediateWinScore) {
      bestImmediateWinScore = res.score;
    }
  }

  // Immediate clear-win shortcut (Clear Rank 1 terminal move found at ply 1)
  if (bestImmediateWinScore >= CLEAR_WIN_THRESHOLD) {
    const winThreshold = bestImmediateWinScore - TIE_EPS;
    const winners: CompactAction[] = [];
    for (let i = 0; i < normalScored.length; i++) {
      if (normalScored[i].isTerminal && normalScored[i].ply1Score >= winThreshold) {
        winners.push(normalScored[i].action);
      }
    }
    for (let i = 0; i < breakScored.length; i++) {
      if (breakScored[i].isTerminal && breakScored[i].ply1Score >= winThreshold) {
        winners.push(breakScored[i].action);
      }
    }
    return winners[pickIndex(winners.length, rng)];
  }

  // Phase 2: Select Top-12 beam preserving up to 9 normal + 3 wall-break candidates
  const beam = buildHardBeam(normalScored, breakScored);

  // Phase 3: 2-ply reply evaluation with alpha-beta (2P) / single-pass Max-N+floor (3P)
  // and strict 145ms deadline guard.
  let bestScore = -Infinity;
  const evaluated: { action: CompactAction; score: number }[] = [];
  const replyActions: CompactAction[] = [];

  for (let i = 0; i < beam.length; i++) {
    if (i > 0 && nowMs() >= deadlineMs) {
      break;
    }

    const cand = beam[i];
    if (cand.isTerminal) {
      evaluated.push({ action: cand.action, score: cand.ply1Score });
      if (cand.ply1Score > bestScore) {
        bestScore = cand.ply1Score;
      }
      continue;
    }

    const origCell = makeCompactAction(board, actorIdx, cand.action);
    // Recompute components so shouldAutoSkipPlayerFast has exact E22/E23 parity
    analyzeComponentsFast(board, scratch);

    let nextIdx = actorIdx;
    for (let offset = 1; offset < board.playerCount; offset++) {
      const candidatePid = (actorIdx + offset) % board.playerCount;
      if (!shouldAutoSkipPlayerFast(board, scratch, candidatePid)) {
        nextIdx = candidatePid;
        break;
      }
    }

    replyActions.length = 0;
    enumerateNormalActionsFast(board, nextIdx, scratch, replyActions);
    if (board.is3P && board.wallBreaksRemaining[nextIdx] > 0) {
      enumerateBreakActionsFast(board, nextIdx, scratch, replyActions);
    }

    let val = cand.ply1Score;
    let timedOut = false;

    if (replyActions.length > 0) {
      if (nextIdx === actorIdx) {
        // Case A (E22/E23): All opponents auto-skipped -> consecutive MAX ply for AI
        let maxFollowUp = -Infinity;
        for (let r = 0; r < replyActions.length; r++) {
          if ((r & 31) === 31 && nowMs() >= deadlineMs) {
            timedOut = true;
            break;
          }
          const reply = replyActions[r];
          const replyOrig = makeCompactAction(board, actorIdx, reply);
          const ev = evaluateSearchBoard(board, actorIdx, scratch).score;
          unmakeCompactAction(board, actorIdx, reply, replyOrig);
          if (ev > maxFollowUp) {
            maxFollowUp = ev;
          }
        }
        val = maxFollowUp;
      } else if (board.playerCount === 2) {
        // Case B (2P): Exact alpha-beta minimax reply minimization
        let minVal = Infinity;
        const hasCutoff = evaluated.length > 0;
        const cutoff = bestScore - TIE_EPS;

        for (let r = 0; r < replyActions.length; r++) {
          if ((r & 31) === 31 && nowMs() >= deadlineMs) {
            timedOut = true;
            break;
          }
          const reply = replyActions[r];
          const replyOrig = makeCompactAction(board, nextIdx, reply);
          const ev = evaluateSearchBoard(board, actorIdx, scratch).score;
          unmakeCompactAction(board, nextIdx, reply, replyOrig);
          if (ev < minVal) {
            minVal = ev;
            if (hasCutoff && minVal < cutoff) {
              break;
            }
          }
        }
        val = minVal;
      } else {
        // Case C (3P): Single-pass realistic Max-N + defensive floor blend
        let bestOppScore = -Infinity;
        let myScoreAtBestOpp = Infinity;
        let worstMyScore = Infinity;

        for (let r = 0; r < replyActions.length; r++) {
          if ((r & 31) === 31 && nowMs() >= deadlineMs) {
            timedOut = true;
            break;
          }
          const reply = replyActions[r];
          const replyOrig = makeCompactAction(board, nextIdx, reply);
          evaluateSearchBoardAll(board, scratch);
          const oppScore = scratch.finalScores[nextIdx];
          const myScore = scratch.finalScores[actorIdx];
          unmakeCompactAction(board, nextIdx, reply, replyOrig);

          if (myScore < worstMyScore) {
            worstMyScore = myScore;
          }
          if (
            oppScore > bestOppScore + 1e-9 ||
            (Math.abs(oppScore - bestOppScore) <= 1e-9 && myScore < myScoreAtBestOpp)
          ) {
            bestOppScore = oppScore;
            myScoreAtBestOpp = myScore;
          }
        }
        val = 0.75 * myScoreAtBestOpp + 0.25 * worstMyScore;
      }
    }

    unmakeCompactAction(board, actorIdx, cand.action, origCell);

    if (timedOut) {
      break;
    }

    evaluated.push({ action: cand.action, score: val });
    if (val > bestScore) {
      bestScore = val;
    }
  }

  if (evaluated.length === 0) {
    return beam[0].action;
  }

  const threshold = bestScore - TIE_EPS;
  const bestActions: CompactAction[] = [];
  for (let i = 0; i < evaluated.length; i++) {
    if (evaluated[i].score >= threshold) {
      bestActions.push(evaluated[i].action);
    }
  }

  return bestActions[pickIndex(bestActions.length, rng)];
}

/**
 * Selects a complete atomic turn action during `phase === 'select_piece'` (F22, E27).
 * Never mutates `state`.
 */
export function chooseAiTurn(
  state: GameState,
  difficulty: AIDifficulty,
  rng: RngFn = Math.random,
): BotTurnAction {
  if (state.phase !== 'select_piece') {
    throw new Error(
      `chooseAiTurn requires phase "select_piece", received "${state.phase}"`,
    );
  }
  const actor = state.players[state.currentPlayerIndex];
  if (!actor) {
    throw new Error(
      `chooseAiTurn: invalid currentPlayerIndex ${state.currentPlayerIndex}`,
    );
  }
  const actorIdx = findPlayerIndex(state, actor.id);
  if (actorIdx < 0) {
    throw new Error(`chooseAiTurn: player ${actor.id} not found in state.players`);
  }

  const board = createSearchBoard(state);
  const scratch = createEvalScratch();

  const normalActions: CompactAction[] = [];
  const breakActions: CompactAction[] = [];
  enumerateNormalActionsFast(board, actorIdx, scratch, normalActions);
  enumerateBreakActionsFast(board, actorIdx, scratch, breakActions);

  if (normalActions.length === 0 && breakActions.length === 0) {
    throw new Error(`chooseAiTurn: no legal actions for player ${actor.id}`);
  }

  let chosen: CompactAction;
  if (difficulty === 'easy') {
    chosen = chooseEasyTurn(board, actorIdx, normalActions, breakActions, scratch, rng);
  } else if (difficulty === 'normal') {
    chosen = chooseNormalTurn(board, actorIdx, normalActions, breakActions, scratch, rng);
  } else {
    chosen = chooseHardTurn(board, actorIdx, normalActions, breakActions, scratch, rng);
  }

  return compactToBotAction(board, chosen);
}

/**
 * Executes a `BotTurnAction` strictly through pure `src/engine` transitions.
 * Throws `Error` if ANY engine transition returns `next === prev` (no-op) or if
 * action fields violate engine rules (including Wall Go II 1-wall breakWall verification).
 */
export function applyBotTurnAction(state: GameState, action: BotTurnAction): GameState {
  if (state.phase !== 'select_piece') {
    throw new Error(
      `applyBotTurnAction requires phase "select_piece", received "${state.phase}"`,
    );
  }
  const actor = state.players[state.currentPlayerIndex];
  if (!actor) {
    throw new Error(
      `applyBotTurnAction: invalid currentPlayerIndex ${state.currentPlayerIndex}`,
    );
  }
  if (action.useWallBreak && action.breakWall === null) {
    throw new Error('applyBotTurnAction: useWallBreak is true but breakWall is null');
  }
  if (!action.useWallBreak && action.breakWall !== null) {
    throw new Error('applyBotTurnAction: useWallBreak is false but breakWall is non-null');
  }
  if (action.breakWall !== null && !isValidWallEdge(action.breakWall)) {
    throw new Error('applyBotTurnAction: breakWall is not a valid internal wall edge');
  }

  let cur = assertTransition(state, selectPiece(state, action.pieceId), 'selectPiece');

  if (!action.useWallBreak) {
    cur = assertTransition(cur, movePiece(cur, action.destination), 'movePiece');
  } else {
    const breakWall = action.breakWall!;
    cur = assertTransition(cur, toggleWallBreak(cur), 'toggleWallBreak');

    if (state.ruleVariant === 'wallgo1') {
      cur = assertTransition(cur, breakWallAt(cur, breakWall), 'breakWallAt');
      cur = assertTransition(cur, movePiece(cur, action.destination), 'movePiece');
    } else {
      cur = assertTransition(
        cur,
        selectWallGo2BreakDestination(cur, action.destination),
        'selectWallGo2BreakDestination',
      );
      if (cur.turnSubState.pendingBreakChoice !== null) {
        cur = assertTransition(
          cur,
          confirmWallGo2BreakWall(cur, breakWall),
          'confirmWallGo2BreakWall',
        );
      }
      const broken = cur.turnSubState.brokenWallBeforeMove;
      if (
        cur.phase !== 'place_wall' ||
        broken === null ||
        !isSameWallEdge(broken, breakWall)
      ) {
        throw new Error(
          `applyBotTurnAction: Wall Go II breakWall mismatch (requested ${wallKey(breakWall)}, actual ${broken ? wallKey(broken) : 'none'})`,
        );
      }
    }
  }

  cur = assertTransition(cur, placeWall(cur, action.placeWall), 'placeWall');
  return cur;
}
