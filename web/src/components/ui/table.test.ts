import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Table } from "./table";

describe("Table", () => {
  it("allows both horizontal table panning and vertical page scrolling", () => {
    const markup = renderToStaticMarkup(createElement(Table));

    expect(markup).toContain("touch-pan-x");
    expect(markup).toContain("touch-pan-y");
    expect(markup).toContain("overflow-x-auto");
  });
});
