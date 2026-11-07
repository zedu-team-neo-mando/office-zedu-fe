const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const hudFile = path.join(__dirname, "../src/app/office/_components/Hud.tsx");
const cssFile = path.join(__dirname, "../src/app/office/office.css");

test("Issue #124 - Repositionable and draggable building map", async (t) => {
  const hudCode = fs.readFileSync(hudFile, "utf8");
  const cssCode = fs.readFileSync(cssFile, "utf8");

  await t.test(
    "exports MapDockCorner type and MAP_CORNER_LABELS mapping",
    () => {
      assert.match(
        hudCode,
        /export type MapDockCorner\s*=\s*\|?\s*"bottom-left"\s*\|\s*"bottom-right"\s*\|\s*"top-right"\s*\|\s*"top-left";/,
        "MapDockCorner type must be defined with all 4 corners"
      );
      assert.match(
        hudCode,
        /export const MAP_CORNER_LABELS:\s*Record<MapDockCorner,\s*string>\s*=/,
        "MAP_CORNER_LABELS must be defined and exported"
      );
      assert.ok(
        hudCode.includes('"bottom-left": "Bottom-left"'),
        "Should contain bottom-left label"
      );
      assert.ok(
        hudCode.includes('"bottom-right": "Bottom-right"'),
        "Should contain bottom-right label"
      );
      assert.ok(
        hudCode.includes('"top-right": "Top-right"'),
        "Should contain top-right label"
      );
      assert.ok(
        hudCode.includes('"top-left": "Top-left"'),
        "Should contain top-left label"
      );
    }
  );

  await t.test(
    "persists map corner and custom drag position in localStorage",
    () => {
      assert.ok(
        hudCode.includes('const KEY_MAP_POS = "office-map" + "-position-v1";'),
        "Should define office-map-position-v1 localStorage key"
      );
      assert.match(
        hudCode,
        /localStorage\.getItem\(\s*KEY_MAP_POS\s*\)/,
        "Should read map position from localStorage"
      );
      assert.match(
        hudCode,
        /localStorage\.setItem\(\s*KEY_MAP_POS,\s*JSON\.stringify/,
        "Should write map position to localStorage"
      );
    }
  );

  await t.test(
    "Minimap provides drag handle affordances and corner cycle button",
    () => {
      assert.ok(
        hudCode.includes("GripHorizontal"),
        "Should import and render GripHorizontal icon"
      );
      assert.ok(
        hudCode.includes("Move"),
        "Should import and render Move icon for corner docking"
      );
      assert.ok(
        hudCode.includes("office-map-drag-handle"),
        "Should use office-map-drag-handle CSS class"
      );
      assert.ok(
        hudCode.includes("onCycleCorner"),
        "Minimap should accept and trigger onCycleCorner"
      );
      assert.ok(
        hudCode.includes("onDragStart") &&
          hudCode.includes("onDragMove") &&
          hudCode.includes("onDragEnd"),
        "Minimap should wire pointer drag events"
      );
    }
  );

  await t.test(
    "office.css defines drag handle styling with modern touch and user-select safeguards",
    () => {
      assert.ok(
        cssCode.includes(".office-map-drag-handle"),
        "CSS should define .office-map-drag-handle"
      );
      assert.ok(
        cssCode.includes("touch-action: none;"),
        "CSS should prevent default touch panning during drag"
      );
      assert.ok(
        cssCode.includes("user-select: none;"),
        "CSS should prevent text selection during drag"
      );
      assert.ok(
        cssCode.includes("cursor: grab;"),
        "CSS should show grab cursor on idle"
      );
      assert.ok(
        cssCode.includes("cursor: grabbing;"),
        "CSS should show grabbing cursor on drag"
      );
    }
  );

  await t.test("Hud avoids UI collision in corner dock presets", () => {
    // desktop bottom-right must clear bottom chat/wrench controls
    assert.ok(
      hudCode.includes("bottom-32 sm:bottom-[7.75rem]"),
      "Bottom-right corner dock should sit above chat and furnish controls"
    );
    // mobile bottom-right must use separate offset above chat controls
    assert.ok(
      hudCode.includes("bottom-72"),
      "Mobile bottom-right corner dock should sit above mobile chat controls"
    );
    // top corners must clear top header controls
    assert.ok(
      hudCode.includes("top-28 lg:top-20") &&
        hudCode.includes("top-16 sm:top-20"),
      "Top corner docks should sit below header badges and buttons"
    );
  });
});
