"""The export schema shared by both halves: every JSON file the web app reads is one of these models.

The pipeline validates each export against them, and the web app's TypeScript types are generated
from the JSON Schema written next to the data. Win% values are rounded to one decimal; scores
are White's view where a field says `white`, else mine.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

Colour = Literal["white", "black"]
Result = Literal["win", "draw", "loss"]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Eval(Model):
    """Stockfish's score from White's point of view."""
    cp: int | None
    mate: int | None


class EngineInfo(Model):
    version: str
    pass1: str
    pass2: str


class OpeningRef(Model):
    eco: str
    name: str
    family: str
    variation: str | None
    ply: int


class Mark(Model):
    """chess.com-style Brilliant, Great or Miss, on top of the label (config.toml, analysis.marks)."""
    kind: Literal["brilliant", "great", "miss"]
    gap: float | None          # great: how much worse Stockfish's second choice was (Win%)
    second: str | None         # great: that second choice (uci)
    material: int | None       # brilliant: the mover's material after their next move, vs before the move
    line: list[str]            # brilliant: Stockfish's line that takes the piece (uci, from the position after)
    chance: float | None       # miss: Win% the opponent's move before gave away
    gave_back: float | None    # miss: Win% this move gave back


class Move(Model):
    ply: int
    side: Colour
    san: str
    uci: str
    clock: float | None
    think: float | None
    win: float                 # White's Win% after the move (pass 1)
    eval: Eval | None          # Stockfish's score after the move; None when the game is over
    best: str | None           # Stockfish's top move in the position before (uci, pass 1)
    best_line: list[str]       # its line (uci)
    label: str
    mark: Mark | None
    accuracy: float            # the mover's move accuracy
    phase: Literal["opening", "middlegame", "endgame"]
    record: str | None         # id of my mistake record on this move


class Record(Model):
    id: str
    game: str
    ply: int
    ts: int                    # game start, unix seconds
    colour: Colour
    fen: str                   # position before my move (full FEN)
    san: str
    uci: str
    best: str | None
    best_san: str | None
    best_line: list[str]       # Stockfish's line from the position before (uci)
    best_line_san: str
    reply_line: list[str]      # Stockfish's line after my move (uci)
    reply_line_san: str
    best_eval: Eval | None
    after_eval: Eval | None
    after_terminal: Literal["white", "black", "draw"] | None   # my move ended the game
    win_before: float          # my Win%
    win_after: float
    drop: float
    severity: Literal["inaccuracy", "mistake", "blunder"]
    phase: Literal["opening", "middlegame", "endgame"]
    opening: str | None        # opening family
    endgame_type: str | None
    think: float | None
    clock: float | None
    opp_rating: int | None
    primary: str
    subtype: str | None
    flags: list[str]
    tags: list[str]
    themes: list[str]          # matching Lichess puzzle themes
    confirmed: bool | None     # pass 2 also sees the drop
    source: Literal["pass1", "pass2"]
    net_after: int
    net_best: int | None
    rule: str
    explanation: str           # template text from the facts above
    note: str | None           # Claude's rewording of it (notes.py; checked against the same facts), if any


class LossInfo(Model):
    cause: str
    subtype: str | None
    flags: list[str]
    turning_ply: int | None
    record: str | None


class ThrownInfo(Model):
    peak: float
    ply: int | None
    san: str | None
    drop: float | None


class EndgameInfo(Model):
    start_ply: int             # plies played when the endgame starts
    type: str
    win_start: float
    outcome: str
    spoiler_ply: int | None
    spoiler_san: str | None
    spoiler_drop: float | None
    spoiler_best_line_san: str | None


class Game(Model):
    id: str
    url: str
    start_ts: int
    end_ts: int
    colour: Colour
    opponent: str
    my_rating: int | None
    opp_rating: int | None
    result: Result
    my_code: str
    termination: str | None
    time_control: str
    rated: bool
    initial_fen: str
    start_win: float           # White's Win% in the initial position
    opening: OpeningRef | None
    accuracy: dict[Colour, float | None]
    chesscom_accuracy: dict[Colour, float | None]
    moves: list[Move]
    records: list[Record]
    puzzles: int               # my puzzles from this game
    loss: LossInfo | None
    thrown: ThrownInfo | None
    endgame: EndgameInfo | None


class GameSummary(Model):
    id: str
    start_ts: int
    colour: Colour
    opponent: str
    opp_rating: int | None
    my_rating: int | None
    result: Result
    my_code: str
    opening: str | None
    accuracy: float | None
    plies: int
    inaccuracies: int
    mistakes: int
    blunders: int
    loss_cause: str | None
    thrown: bool
    puzzles: int               # my puzzles from this game


class GamesIndex(Model):
    as_of: int
    games: list[GameSummary]


class MistakesIndex(Model):
    as_of: int
    records: list[Record]


class LossEntry(Model):
    game: str
    ts: int
    cause: str
    subtype: str | None
    flags: list[str]
    turning_ply: int | None
    record: str | None
    colour: Colour
    opponent: str
    final_fen: str             # the position the game ended in (full FEN)
    final_win: float           # my Win% there (pass 1)


class ThrownEntry(Model):
    game: str
    ts: int
    result: Result
    peak: float
    ply: int | None
    san: str | None
    drop: float | None
    colour: Colour
    opponent: str
    fen: str | None            # position before the move that threw the win (full FEN)
    win_before: float | None   # my Win% there (pass 1)


class Losses(Model):
    as_of: int
    total: int
    causes: dict[str, int]
    causes_30_days: dict[str, int]
    losses: list[LossEntry]
    thrown: list[ThrownEntry]


class Leak(Model):
    tag: str
    kind: Literal["primary", "subtype", "flag"]
    count: int
    per_game: float
    recent: float | None
    previous: float | None
    win_lost: float
    records: list[str]


class Leaks(Model):
    as_of: int
    games: int
    recent_games: int
    leaks: list[Leak]


class ExplorerMove(Model):
    uci: str
    san: str
    share: float               # percent of explorer games at my level
    games: int


class ExplorerStats(Model):
    games: int
    moves: list[ExplorerMove]


class TreeMove(Model):
    uci: str
    san: str
    games: int
    score: float               # my score in percent after this move
    avg_drop: float | None     # the mover's average Win% drop (my moves only)


class TreeNode(Model):
    key: str
    fen: str
    my_turn: bool
    games: int
    game_ids: list[str]
    score: float
    moves: list[TreeMove]
    stockfish_best: str | None
    stockfish_best_san: str | None
    stockfish_eval: Eval | None
    explorer: ExplorerStats | None


class OpeningStats(Model):
    games: int
    wins: int
    draws: int
    losses: int
    score: float | None
    score_vs_rest: float | None
    win_after_opening: float | None
    accuracy: float | None
    game_ids: list[str]


class Variation(OpeningStats):
    variation: str


class Family(OpeningStats):
    family: str
    variations: list[Variation]


class LeakCard(Model):
    key: str
    fen: str
    games: int
    avg_drop: float
    score_gap: float | None
    you_play: list[TreeMove]
    stockfish_best: str | None
    stockfish_best_san: str | None
    stockfish_eval: Eval | None
    level_best: str | None     # players at my level: their most common move
    level_best_san: str | None
    level_share: float | None


class Surprise(Model):
    game: str
    ply: int
    fen: str                   # before the opponent's move
    their_san: str
    their_share: float
    explorer_games: int
    my_san: str
    my_drop: float
    record: str | None


class OpeningReport(Model):
    as_of: int
    colour: Colour
    games: int
    score: float | None
    families: list[Family]
    tree: list[TreeNode]
    leaks: list[LeakCard]
    surprises: list[Surprise]


class EndgameGame(Model):
    game: str
    ts: int
    result: Result
    colour: Colour
    opponent: str
    info: EndgameInfo
    spoiler_fen: str | None    # spoiled: the position before the spoiling move (full FEN)
    spoiler_win: float | None  # and my Win% there (pass 1)


class Endgames(Model):
    as_of: int
    games: int
    table: dict[str, dict[str, int]]
    endgames: list[EndgameGame]


class GroupStat(Model):
    key: str | int
    games: int
    score: float | None
    accuracy: float | None


class PhaseStat(Model):
    key: str
    moves: int
    accuracy: float | None
    mistakes_per_game: float


class ThinkStat(Model):
    key: str
    moves: int
    blunder_rate: float
    mistake_or_worse_rate: float


class RatingPoint(Model):
    ts: int
    rating: int


class EndgameWindow(Model):
    """A run of my endgames, by my Win% when each started (config.toml bands) and how it turned out."""
    endgames: int
    winning: int               # started winning
    converted: int             # and won
    balanced: int
    held: int                  # and drew or won
    losing: int
    saved: int                 # and drew or won
    accuracy: float | None     # my move accuracy in those endgames


class EndgameTrend(Model):
    recent: EndgameWindow      # my last recent_games endgames
    previous: EndgameWindow | None   # the recent_games before them


class Insights(Model):
    as_of: int
    by_colour: list[GroupStat]
    by_opening: list[GroupStat]
    by_phase: list[PhaseStat]
    by_opponent_rating: list[GroupStat]
    by_hour: list[GroupStat]
    by_length: list[GroupStat]
    by_previous_result: list[GroupStat]
    think_time: list[ThinkStat]
    time_losses: dict[str, int | dict[str, int]]
    rating: list[RatingPoint]
    leak_rates: dict[str, dict[str, float | None] | list[int]]
    endgames: EndgameTrend | None


class TopLeak(Model):
    tag: str
    kind: str
    count: int
    per_game: float
    recent: float | None
    previous: float | None
    win_lost: float


class MaiaLevel(Model):
    chesscom: int              # the chess.com rapid rating the bot plays like
    lichess: int               # the same rating on Lichess's rapid scale (rating_map), which Maia-2 takes


class Bots(Model):
    """Play on in Compare: who can answer my moves. Maia-2 only picks the bot's moves; it never scores or labels."""
    maia: list[MaiaLevel]
    me_lichess: int | None     # my rating on Lichess's scale: the opponent rating Maia-2 is given


class Summary(Model):
    as_of: int
    username: str
    rating: int | None
    rating_goal: int
    goal_date: str
    games: int                 # parsed games in scope
    analysed: int              # games with complete Stockfish results
    records: int
    losses: int
    why_i_lost: dict[str, int]
    why_i_lost_30_days: dict[str, int]
    top_leaks: list[TopLeak]
    thrown: int
    engine: EngineInfo
    bots: Bots


class Puzzle(Model):
    """A position to solve. The solver is the side to move in `fen`; the solution alternates the solver's
    moves (even indices) and the replies."""
    id: str                    # m-<record id> or l-<Lichess PuzzleId>
    source: Literal["mine", "lichess"]
    fen: str
    last_move: str | None      # the move that led to the position (UCI), shown on the board
    solution: list[str]        # UCI
    solution_san: list[str]
    unique: list[bool]         # per solver move: clearly best in pass 2, so no other move solves it
    tags: list[str]            # my tags: the record's, or those whose Lichess themes the puzzle has
    themes: list[str]          # Lichess themes
    rating: int | None         # Lichess puzzle rating
    game: str | None           # mine: the game, the ply of my move, what I played and the Win% it lost
    ply: int | None
    played_san: str | None
    drop: float | None
    played_line: list[str]     # mine: my move (UCI), then Stockfish's line after it; empty for Lichess
    played_line_san: list[str]
    opening: str | None        # family (mine) or OpeningTags (Lichess)
    url: str | None            # Lichess puzzle page
    why: str                   # shown once it's over: what the solution does on the board (measured, why.py)


class PuzzleSet(Model):
    as_of: int
    source: Literal["mine", "lichess"]
    puzzles: list[Puzzle]


class PuzzleIndex(Model):
    """How many puzzles each set has per tag, so pages can offer a drill without loading the sets."""
    as_of: int
    mine: dict[str, int]
    lichess: dict[str, int]


class Alternative(Model):
    """One legal move where the trainer asks for mine, scored like a move in my games (pass 1, the position
    after it)."""
    uci: str
    san: str
    eval: Eval | None          # Stockfish's score after it; None when it ends the game or isn't analysed yet
    terminal: Literal["white", "black", "draw"] | None   # the move ends the game
    win: float | None          # my Win% after it
    why: str                   # what it does on the board along Stockfish's line after it (measured, why.py)


class LineStep(Model):
    """One move of a trainer line, with what's known about it."""
    san: str
    key: str | None            # where the drill asks for this move: the position, a key into Repertoire.positions
    eval: Eval | None          # Stockfish's score after the move (pass 1)
    terminal: Literal["white", "black", "draw"] | None
    win: float | None          # my Win% after the move
    top: bool | None           # asked moves: no other legal move has a higher stored score
    share: float | None        # percent of games at my level with this move here (Lichess explorer)
    most_common: bool          # the explorer's most played move here
    opening: str | None        # the named opening the move reaches, when the name changes
    reason: str                # what the move does on the board (measured, why.py); empty when nothing measured


class RepertoireLine(Model):
    id: str                    # stable across builds: from the colour and the moves
    colour: Colour             # the side I play
    name: str
    source: Literal["repertoire", "leak"]
    moves: list[str]           # UCI from the start position
    san: list[str]
    start: int                 # plies played for me before the drill asks (a leak line asks only at its end)
    steps: list[LineStep]      # one per move


class Repertoire(Model):
    as_of: int
    pgn: str | None            # the PGN the lines were read from (None when there isn't one yet)
    lines: list[RepertoireLine]
    positions: dict[str, list[Alternative]]   # every legal move where a drill asks for mine, best first


FILES = {
    "summary.json": Summary,
    "games/index.json": GamesIndex,
    "mistakes/index.json": MistakesIndex,
    "losses.json": Losses,
    "leaks.json": Leaks,
    "openings/white.json": OpeningReport,
    "openings/black.json": OpeningReport,
    "endgames.json": Endgames,
    "insights.json": Insights,
    "puzzles/mine.json": PuzzleSet,
    "puzzles/lichess.json": PuzzleSet,
    "puzzles/index.json": PuzzleIndex,
    "repertoire.json": Repertoire,
}
