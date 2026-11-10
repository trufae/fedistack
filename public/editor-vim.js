/* Small, dependency-free Vim controls for an article textarea. */
var ArticleVim = (() => {
  function attach(textarea, options) {
    let mode = "normal", cursor = textarea.selectionStart, anchor = cursor;
    let column = null, pending = "", register = "", linewise = false, editing = false;
    let lastStart = -1, lastEnd = -1, source, stops = [];
    const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter() : null;

    function boundaries() {
      if (source !== textarea.value) {
        source = textarea.value;
        stops = segmenter ? Array.from(segmenter.segment(source), (part) => part.index) : [];
        if (!segmenter) {
          let offset = 0;
          for (const character of source) { stops.push(offset); offset += character.length; }
        }
        stops.push(source.length);
      }
      return stops;
    }
    function index(position) {
      const points = boundaries();
      let low = 0, high = points.length - 1;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (points[mid] <= position) low = mid;
        else high = mid - 1;
      }
      return low;
    }
    const next = (position) => boundaries()[Math.min(index(position) + 1, stops.length - 1)];
    const previous = (position) => boundaries()[Math.max(0, index(position) - 1)];
    const lineStart = (position) => position > 0 ? textarea.value.lastIndexOf("\n", position - 1) + 1 : 0;
    function lineEnd(position) {
      const end = textarea.value.indexOf("\n", position);
      return end < 0 ? textarea.value.length : end;
    }
    function normalCursor(position) {
      position = boundaries()[index(Math.max(0, Math.min(position, textarea.value.length)))];
      return position === lineEnd(position) && position > lineStart(position) ? previous(position) : position;
    }
    function setMode(value) {
      mode = value;
      pending = "";
      column = null;
      textarea.dataset.vimMode = mode;
      options.onModeChange(mode);
    }
    function revealCursor() {
      const doc = textarea.ownerDocument;
      if (doc.activeElement !== textarea) return;
      // Selection APIs don't reliably scroll textareas. Mirror wrapping to find
      // the active end, including long Markdown paragraphs and visual selections.
      const style = doc.defaultView.getComputedStyle(textarea);
      const mirror = doc.createElement("div"), marker = doc.createElement("span");
      mirror.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;top:0;left:-10000px;white-space:pre-wrap;overflow-wrap:break-word;box-sizing:border-box";
      for (const property of ["font", "lineHeight", "letterSpacing", "wordSpacing", "tabSize", "padding", "textIndent"])
        mirror.style[property] = style[property];
      mirror.style.width = `${textarea.clientWidth}px`;
      mirror.textContent = textarea.value.slice(0, cursor);
      marker.textContent = textarea.value.slice(cursor, next(cursor)) || "\u200b";
      mirror.append(marker, doc.createTextNode(textarea.value.slice(next(cursor))));
      doc.body.append(mirror);
      const top = marker.offsetTop, height = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
      if (top < textarea.scrollTop) textarea.scrollTop = top;
      else if (top + height > textarea.scrollTop + textarea.clientHeight)
        textarea.scrollTop = top + height - textarea.clientHeight;
      mirror.remove();
    }
    function paint() {
      cursor = normalCursor(cursor);
      let start = cursor, end = cursor;
      if (mode === "visual") {
        start = Math.min(anchor, cursor);
        end = next(Math.max(anchor, cursor));
      } else if (mode === "visual-line") {
        start = lineStart(Math.min(anchor, cursor));
        end = Math.min(textarea.value.length, lineEnd(Math.max(anchor, cursor)) + 1);
      }
      textarea.setSelectionRange(start, end, cursor < anchor ? "backward" : "forward");
      lastStart = start;
      lastEnd = end;
      revealCursor();
    }
    function sync() {
      if (textarea.selectionStart === lastStart && textarea.selectionEnd === lastEnd) return;
      pending = "";
      column = null;
      const start = textarea.selectionStart, end = textarea.selectionEnd;
      if (start !== end) {
        const backwards = textarea.selectionDirection === "backward";
        cursor = backwards ? start : previous(end);
        anchor = backwards ? previous(end) : start;
        if (mode !== "visual-line") setMode("visual");
      } else {
        cursor = start;
        if (mode !== "normal") setMode("normal");
      }
    }
    function move(key) {
      const start = lineStart(cursor), end = lineEnd(cursor);
      if (key !== "j" && key !== "k") column = null;
      if (key === "h") cursor = Math.max(start, previous(cursor));
      else if (key === "l") cursor = Math.min(end > start ? previous(end) : end, next(cursor));
      else if (key === "0") cursor = start;
      else if (key === "^") cursor = start + Math.max(0, textarea.value.slice(start, end).search(/\S/));
      else if (key === "$") cursor = end > start ? previous(end) : end;
      else if (key === "G") cursor = lineStart(textarea.value.length);
      else if (key === "j" || key === "k") {
        column ??= index(cursor) - index(start);
        const target = key === "j" ? (end < textarea.value.length ? end + 1 : start)
          : (start > 0 ? lineStart(start - 1) : start);
        cursor = boundaries()[Math.min(index(target) + column, index(lineEnd(target)))];
      } else if (key === "w" || key === "b" || key === "e") {
        const kind = (position) => /\s/.test(textarea.value.slice(position, next(position))) ? 0
          : /[\p{L}\p{N}_]/u.test(textarea.value.slice(position, next(position))) ? 1 : 2;
        if (key === "b") {
          cursor = previous(cursor);
          while (cursor > 0 && !kind(cursor)) cursor = previous(cursor);
          while (cursor > 0 && kind(previous(cursor)) === kind(cursor)) cursor = previous(cursor);
        } else if (key === "w") {
          const current = kind(cursor);
          while (cursor < textarea.value.length && kind(cursor) === current) cursor = next(cursor);
          while (cursor < textarea.value.length && !kind(cursor)) cursor = next(cursor);
        } else {
          cursor = next(cursor);
          while (cursor < textarea.value.length && !kind(cursor)) cursor = next(cursor);
          while (next(cursor) < textarea.value.length && kind(next(cursor)) === kind(cursor)) cursor = next(cursor);
        }
      } else return false;
      paint();
      return true;
    }
    function replace(text, start, end, insert = false) {
      setMode(insert ? "insert" : "normal");
      editing = true;
      try { options.replace(text, start, end); }
      finally { editing = false; }
      cursor = textarea.selectionStart;
      if (!insert) paint();
    }
    function operate(key, wholeLine = false) {
      let start = wholeLine ? lineStart(cursor) : textarea.selectionStart;
      const end = wholeLine ? Math.min(textarea.value.length, lineEnd(cursor) + 1) : textarea.selectionEnd;
      linewise = wholeLine || mode === "visual-line";
      register = textarea.value.slice(start, end);
      if (linewise && !register) register = "\n";
      if (key === "y") { cursor = start; setMode("normal"); paint(); return; }
      // Deleting the last line also removes its preceding separator.
      if (linewise && end === textarea.value.length && start > 0 && key !== "c" &&
          (start === end || textarea.value[end - 1] !== "\n")) start--;
      const replacement = linewise && key === "c" && end > start && textarea.value[end - 1] === "\n" ? "\n" : "";
      replace(replacement, start, end, key === "c");
      if (key === "c") textarea.setSelectionRange(start, start);
    }
    function keydown(event) {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || textarea.disabled || textarea.readOnly || !options.canEdit()) return;
      // Keep browser/app shortcuts, including save, formatting, copy and undo.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (mode === "insert" && event.key !== "Escape") return;
      if (event.key === "Tab") {
        if (mode !== "insert") event.stopPropagation(); // Tab can leave the body.
        return;
      }
      if (event.key.length > 1 && !["Escape", "ArrowLeft", "ArrowDown", "ArrowUp", "ArrowRight", "Home", "End", "Backspace", "Delete", "Enter"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        if (mode === "insert") {
          cursor = textarea.selectionStart;
          if (cursor > lineStart(cursor)) cursor = previous(cursor);
        } else sync();
        setMode("normal");
        paint();
        return;
      }
      sync();
      const key = { ArrowLeft: "h", ArrowDown: "j", ArrowUp: "k", ArrowRight: "l", Home: "0", End: "$" }[event.key] || event.key;
      const command = pending;
      pending = "";
      if (command === "g" && key === "g") { cursor = 0; column = null; paint(); return; }
      if (command === key && ["d", "c", "y"].includes(key)) { operate(key, true); return; }
      if (move(key)) return;
      if (key === "v" || key === "V") {
        const target = key === "v" ? "visual" : "visual-line";
        if (mode === "normal") anchor = cursor;
        setMode(mode === target ? "normal" : target);
        paint();
      } else if (["d", "c", "y"].includes(key)) {
        if (mode.startsWith("visual")) operate(key);
        else pending = key;
      } else if ((key === "x" || key === "Delete" || key === "Backspace") && mode.startsWith("visual")) operate("d");
      else if (key === "x" || key === "Delete") {
        if (cursor < lineEnd(cursor)) {
          register = textarea.value.slice(cursor, next(cursor));
          linewise = false;
          replace("", cursor, next(cursor));
        }
      } else if (key === "g") pending = key;
      else if (["i", "a", "I", "A", "o", "O"].includes(key)) {
        let position = cursor;
        if (key === "a") position = Math.min(lineEnd(cursor), next(cursor));
        if (key === "I") { move("^"); position = cursor; }
        if (key === "A" || key === "o") position = lineEnd(cursor);
        if (key === "O") position = lineStart(cursor);
        if (key === "o" || key === "O") {
          replace("\n", position, position, true);
          if (key === "O") textarea.setSelectionRange(position, position);
        } else {
          setMode("insert");
          textarea.setSelectionRange(position, position);
        }
      } else if ((key === "p" || key === "P") && register) {
        let start = cursor, end = cursor, text = register;
        if (mode.startsWith("visual")) { start = textarea.selectionStart; end = textarea.selectionEnd; }
        else if (linewise) {
          start = end = key === "P" ? lineStart(cursor) : Math.min(textarea.value.length, lineEnd(cursor) + 1);
          text = register.endsWith("\n") ? register : register + "\n";
          if (key === "p" && lineEnd(cursor) === textarea.value.length) text = "\n" + text.slice(0, -1);
        } else start = end = key === "P" ? cursor : Math.min(lineEnd(cursor), next(cursor));
        replace(text, start, end);
        cursor = linewise ? Math.min(textarea.value.length, start + (text.startsWith("\n") ? 1 : 0)) : previous(start + text.length);
        paint();
      } else if (key === "u") {
        setMode("normal");
        textarea.ownerDocument.execCommand("undo");
        cursor = textarea.selectionStart;
        paint();
      }
    }
    function input() {
      if (editing || mode === "insert") return;
      cursor = textarea.selectionStart;
      setMode("normal");
      paint();
    }
    function pointerup() {
      if (mode !== "insert") { sync(); paint(); }
    }
    textarea.addEventListener("keydown", keydown);
    textarea.addEventListener("input", input);
    textarea.addEventListener("pointerup", pointerup);
    setMode("normal");
    paint();
    return () => {
      textarea.removeEventListener("keydown", keydown);
      textarea.removeEventListener("input", input);
      textarea.removeEventListener("pointerup", pointerup);
      delete textarea.dataset.vimMode;
    };
  }
  return { attach };
})();
