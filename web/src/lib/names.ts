// Display names for the pipeline's tags, worded as in docs/BRIEF.md. Descriptions restate the rule that
// put a move in the bucket (thresholds from config.toml); they never judge a position themselves.

export const TYPE: { [tag: string]: string } = {
  allowed_mate: "Allowed mate", hung_piece: "Hung a piece", tactic: "Walked into a tactic",
  missed_mate: "Missed mate", missed_win: "Missed a win", quiet: "Quiet mistake",
  clock: "Flagged while playable", gave_up: "Gave up while playable", outplayed: "Outplayed slowly",
};
export const SUB: { [tag: string]: string } = {
  double_check: "Double check", fork: "Fork", pin: "Pin", skewer: "Skewer",
  discovered_attack: "Discovered attack", other: "Other tactics", free_material: "Free material",
};
export const FLAG: { [tag: string]: string } = {
  threw_away_win: "Threw away a win", opening: "In the opening", endgame: "In the endgame",
  fast: "Fast blunder", time_trouble: "In time trouble", after_loss: "Right after a loss",
};
const NAME: { [tag: string]: string } = { ...TYPE, ...SUB, ...FLAG };
export const tagName = (tag: string) => NAME[tag] ?? tag.replace(/_/g, " ");

export const DESC: { [tag: string]: string } = {
  allowed_mate: "After your move Stockfish reports a forced mate against you, and before it didn't.",
  hung_piece: "Stockfish's reply to your move is a capture, and you end its line 2 or more points of material down.",
  tactic: "You end Stockfish's line 2 or more points of material down, but its first reply isn't the capture.",
  missed_mate: "Stockfish had mate in 3 or less for you, and your move didn't keep one.",
  missed_win: "Stockfish's best move was worth 15+ Win% more and its line, findable in 3 of your moves, wins 2+ points of material.",
  quiet: "Your Win% dropped with no mate and no 2-point material swing in Stockfish's line. Compare your move with its best.",
  double_check: "The key move in Stockfish's line gives double check.",
  fork: "The key move in Stockfish's line is a fork, by Lichess's definition.",
  pin: "The key move in Stockfish's line is a pin, by Lichess's definition.",
  skewer: "The key move in Stockfish's line is a skewer, by Lichess's definition.",
  discovered_attack: "The key move in Stockfish's line is a discovered attack, by Lichess's definition.",
  other: "Material changes hands in Stockfish's line, but its key move matches none of the named patterns.",
  free_material: "Stockfish's best move was a capture that wins 2+ points of material outright.",
  threw_away_win: "Your Win% was 80 or more before the move and below 60 after it.",
  opening: "The move was played in the opening phase.",
  endgame: "The move was played in the endgame phase.",
  fast: "A mistake or blunder played faster than 3 out of 4 of your moves at that time control.",
  time_trouble: "Your clock was below 10% of the starting time.",
  after_loss: "The game started within 30 minutes of a lost game ending.",
};

export const KIND_TITLE = { primary: "What went wrong", subtype: "Tactic patterns", flag: "When it happens" } as const;

// Short tags for the move list.
export const SHORT: { [tag: string]: string } = {
  hung_piece: "hung", quiet: "quiet", tactic: "tactic", allowed_mate: "mate", missed_mate: "missed #", missed_win: "missed win",
};

export type Severity = "inaccuracy" | "mistake" | "blunder";
export const SEVERITIES: Severity[] = ["inaccuracy", "mistake", "blunder"];
export const SEV: { [s: string]: string } = { inaccuracy: "Inaccuracy", mistake: "Mistake", blunder: "Blunder" };
export const NAG: { [s: string]: string } = { inaccuracy: "?!", mistake: "?", blunder: "??" };
export const LABEL: { [s: string]: string } = { book: "Book move", best: "Best move", excellent: "Excellent", good: "Good", ...SEV };

export const RESULT_WORD = { win: "Won", loss: "Lost", draw: "Drew" } as const;
