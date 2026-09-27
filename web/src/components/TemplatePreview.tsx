import type { AppTemplateId } from "@contracts/settings";

/** A compact POS layout preview; never mounts demo routes or demo data. */
export default function TemplatePreview({
  template,
}: {
  template: AppTemplateId;
}) {
  const isTailAdmin = template === "tailadmin";
  const accent = isTailAdmin ? "#465fff" : "#168c82";
  const sidebar = isTailAdmin ? "#ffffff" : "#102b3a";
  const muted = isTailAdmin ? "#98a2b3" : "#a0b5c0";

  return (
    <div
      aria-hidden="true"
      className="flex h-40 overflow-hidden border-b border-border sm:h-44"
      style={{ backgroundColor: isTailAdmin ? "#f9fafb" : "#eef3f6" }}
    >
      <div
        className="w-[26%] shrink-0 border-r p-3"
        style={{
          backgroundColor: sidebar,
          borderColor: isTailAdmin ? "#eaecf0" : sidebar,
        }}
      >
        <div className="mb-4 flex items-center gap-1.5">
          <div
            className="size-5 rounded-md"
            style={{ backgroundColor: accent }}
          />
          <div
            className="h-1.5 w-7 rounded-full"
            style={{ backgroundColor: muted }}
          />
        </div>
        <div className="space-y-2">
          {[0, 1, 2, 3].map(index => (
            <div
              key={index}
              className="flex h-4 items-center gap-1.5 rounded px-1"
              style={{
                backgroundColor:
                  index === 0
                    ? isTailAdmin
                      ? "#eef4ff"
                      : "#19404c"
                    : undefined,
              }}
            >
              <div
                className="size-2 rounded-sm"
                style={{ backgroundColor: index === 0 ? accent : muted }}
              />
              <div
                className="h-1 flex-1 rounded-full"
                style={{
                  backgroundColor: index === 0 ? accent : muted,
                  opacity: 0.65,
                }}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex h-8 items-center justify-between border-b border-[#eaecf0] bg-white px-3">
          <div className="h-1.5 w-16 rounded-full bg-[#d0d5dd]" />
          <div
            className="size-4 rounded-full"
            style={{ backgroundColor: accent, opacity: 0.2 }}
          />
        </div>
        <div className="space-y-2 p-3">
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map(index => (
              <div
                key={index}
                className="space-y-2 rounded-lg border border-[#eaecf0] bg-white p-2"
              >
                <div className="h-1 w-3/4 rounded-full bg-[#d0d5dd]" />
                <div
                  className="h-2 w-1/2 rounded-full"
                  style={{ backgroundColor: accent }}
                />
              </div>
            ))}
          </div>
          <div className="flex h-14 items-end gap-2 rounded-lg border border-[#eaecf0] bg-white px-3 pb-2 pt-3">
            {[45, 70, 55, 90, 65, 80, 100].map((height, index) => (
              <div
                key={index}
                className="flex-1 rounded-t-sm"
                style={{
                  height: `${height}%`,
                  backgroundColor: accent,
                  opacity: index === 3 ? 1 : 0.2,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
