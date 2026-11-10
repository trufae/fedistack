import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../dist/editor-vim.js", import.meta.url), "utf8");
function editor(value, position = 0) {
  const context = vm.createContext({});
  vm.runInContext(source, context);
  const textarea = new EventTarget();
  const modes = [], commands = [];
  Object.assign(textarea, {
    value, selectionStart: position, selectionEnd: position, dataset: {},
    ownerDocument: { execCommand: (command) => { commands.push(command); return true; } },
    setSelectionRange(start, end, direction = "none") {
      this.selectionStart = start;
      this.selectionEnd = end;
      this.selectionDirection = direction;
    },
    setRangeText(text, start, end) {
      this.value = this.value.slice(0, start) + text + this.value.slice(end);
      this.setSelectionRange(start + text.length, start + text.length);
      this.dispatchEvent(new Event("input"));
    },
  });
  let canEdit = true;
  const detach = context.ArticleVim.attach(textarea, {
    onModeChange: (mode) => modes.push(mode),
    canEdit: () => canEdit,
    replace: (text, start, end) => textarea.setRangeText(text, start, end),
  });
  const key = (key, modifiers = {}) => {
    const event = new Event("keydown", { cancelable: true });
    Object.assign(event, { key, ...modifiers });
    textarea.dispatchEvent(event);
    return event;
  };
  return {
    textarea, key, modes, commands, detach,
    keys: (...keys) => keys.forEach((value) => key(value)),
    selected: () => textarea.value.slice(textarea.selectionStart, textarea.selectionEnd),
    type: (text) => textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd),
    lock: () => { canEdit = false; },
  };
}

test("Vim horizontal and vertical motion preserves the desired column across short and empty lines", () => {
  const { textarea: t, keys } = editor("abcdef\nx\n\nuvwxyz", 4);
  keys("j"); assert.equal(t.selectionStart, 7);
  keys("j"); assert.equal(t.selectionStart, 9);
  keys("j"); assert.equal(t.selectionStart, 14);
  keys("k", "k", "k"); assert.equal(t.selectionStart, 4);
  keys("$", "l"); assert.equal(t.selectionStart, 5);
  keys("0", "h"); assert.equal(t.selectionStart, 0);
  keys("G", "$", "l", "j"); assert.equal(t.selectionStart, 15);
  keys("g", "g"); assert.equal(t.selectionStart, 0);
  assert.equal(t.value, "abcdef\nx\n\nuvwxyz");
});

test("Vim word motions handle punctuation and insertion at line boundaries", () => {
  const { textarea: t, keys, type } = editor("  one, two\nlast");
  keys("^"); assert.equal(t.selectionStart, 2);
  keys("e"); assert.equal(t.selectionStart, 4);
  keys("w"); assert.equal(t.selectionStart, 5);
  keys("w"); assert.equal(t.selectionStart, 7);
  keys("b"); assert.equal(t.selectionStart, 5);
  keys("I"); type("start "); keys("Escape", "A"); type("!");
  assert.equal(t.value, "  start one, two!\nlast");
  keys("Escape"); assert.equal(t.selectionStart, t.value.indexOf("!"));
});

test("Vim insert, append and Escape keep typing native and commands out of the text", () => {
  const { textarea: t, key, keys, type, modes } = editor("abc");
  assert.equal(key("z").defaultPrevented, true);
  keys("i");
  assert.equal(key("h").defaultPrevented, false);
  type("hi");
  keys("Escape");
  assert.equal(t.selectionStart, 1);
  assert.equal(modes.at(-1), "normal");
  keys("a"); type("!"); keys("Escape");
  assert.equal(t.value, "hi!abc");
  assert.equal(t.selectionStart, 2);
});

test("Vim visual selections include both endpoints and reverse across their anchor", () => {
  const { textarea: t, keys, selected, type } = editor("abcdef", 2);
  keys("v"); assert.equal(selected(), "c");
  keys("l", "l"); assert.equal(selected(), "cde");
  keys("h", "h", "h"); assert.equal(selected(), "bc");
  assert.equal(t.selectionDirection, "backward");
  keys("c"); assert.equal(t.dataset.vimMode, "insert");
  type("XY"); keys("Escape");
  assert.equal(t.value, "aXYdef");
  keys("v", "l", "y", "$", "p");
  assert.equal(t.value, "aXYdefYd");
});

test("Vim line selections, delete and paste preserve separators at the end of a document", () => {
  for (const value of ["one\ntwo\nthree", "one\ntwo\nthree\n"]) {
    const { textarea: t, keys, selected } = editor(value);
    keys("V", "j"); assert.equal(selected(), "one\ntwo\n");
    keys("y", "G", "P");
    assert.equal(t.value, value.endsWith("\n") ? "one\ntwo\nthree\none\ntwo\n" : "one\ntwo\none\ntwo\nthree");
  }
  const { textarea: t, keys } = editor("one\ntwo\n", 4);
  keys("d", "d"); assert.equal(t.value, "one\n");
  keys("G", "d", "d"); assert.equal(t.value, "one");
  keys("p"); assert.equal(t.value, "one\n");
  keys("G", "c", "c"); assert.equal(t.value, "one\n");
  assert.equal(t.dataset.vimMode, "insert");
});

test("Vim opens lines above and below without consuming existing content", () => {
  const { textarea: t, keys, type } = editor("first\nlast");
  keys("o"); type("middle"); keys("Escape", "O"); type("above"); keys("Escape");
  assert.equal(t.value, "first\nabove\nmiddle\nlast");
  assert.equal(t.dataset.vimMode, "normal");
});

test("Vim handles empty documents, leading blank lines and graphemes without splitting text", () => {
  const { textarea: empty, keys } = editor("");
  keys("h", "j", "k", "l", "w", "b", "e", "$", "g", "g", "G", "x", "v", "d");
  assert.equal(empty.value, "");
  assert.equal(empty.selectionStart, 0);
  const blank = editor("\ntext");
  blank.keys("h", "l"); assert.equal(blank.textarea.selectionStart, 0);
  blank.keys("j"); assert.equal(blank.textarea.selectionStart, 1);
  const unicode = editor("A👩🏽‍💻e\u0301Z");
  unicode.keys("l", "v"); assert.equal(unicode.selected(), "👩🏽‍💻");
  unicode.keys("l"); assert.equal(unicode.selected(), "👩🏽‍💻e\u0301");
  unicode.keys("d"); assert.equal(unicode.textarea.value, "AZ");
});

test("Vim respects mouse selections, external edits, native shortcuts, composition and detachment", () => {
  const { textarea: t, key, keys, commands, detach } = editor("abcdef");
  t.setSelectionRange(1, 4, "backward");
  t.dispatchEvent(new Event("pointerup"));
  keys("d"); assert.equal(t.value, "aef");
  t.setSelectionRange(2, 2); // A toolbar can move the cursor without dispatching input.
  keys("x"); assert.equal(t.value, "ae");
  for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { keyCode: 229 }])
    assert.equal(key("a", modifiers).defaultPrevented, false);
  assert.equal(key("Tab").defaultPrevented, false);
  keys("u"); assert.deepEqual(commands, ["undo"]);
  detach();
  assert.equal(key("x").defaultPrevented, false);
  assert.equal(t.dataset.vimMode, undefined);
});
