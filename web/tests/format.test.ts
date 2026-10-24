// Parsing and formatting only, so hand-written inputs are fine here.
import { clock, evalFor, moveName, perGame, sanTokens, signed, timeControl } from "../src/lib/format";

test("SAN lines split into one numbered label per move", () => {
  expect(sanTokens("14...Rb6 15. Qa5 Rb8")).toEqual(["14…Rb6", "15. Qa5", "Rb8"]);
  expect(sanTokens("4. cxd5 Nxd5 5. Nf3")).toEqual(["4. cxd5", "Nxd5", "5. Nf3"]);
  expect(sanTokens("")).toEqual([]);
});

test("move names number White and Black moves", () => {
  expect(moveName(1, "d4")).toBe("1. d4");
  expect(moveName(2, "d5")).toBe("1…d5");
  expect(moveName(250, "Ra3+")).toBe("125…Ra3+");
});

test("scores are shown from the given side", () => {
  expect(evalFor({ cp: 80, mate: null }, "white")).toBe("+0.8");
  expect(evalFor({ cp: 80, mate: null }, "black")).toBe("−0.8");
  expect(evalFor({ cp: null, mate: 3 }, "white")).toBe("#3");
  expect(evalFor({ cp: null, mate: 3 }, "black")).toBe("#−3");
  expect(evalFor(null, "white")).toBe("–");
  expect(signed(0)).toBe("0.0");
});

test("clocks, time controls and rates", () => {
  expect(clock(599.9)).toBe("9:59");
  expect(clock(44)).toBe("0:44");
  expect(clock(3725)).toBe("1:02:05");
  expect(timeControl("600")).toBe("10 min");
  expect(timeControl("180+2")).toBe("3 min + 2");
  expect(perGame(3.676)).toBe("3.7");
  expect(perGame(0.04)).toBe("0.04");
  expect(perGame(0.001)).toBe("<0.01");
});
