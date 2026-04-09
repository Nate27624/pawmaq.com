import type { FeedTab } from "../types";

interface SideNavProps {
  activeTab: FeedTab;
  onTabChange: (tab: FeedTab) => void;
}

export function SideNav({
  activeTab,
  onTabChange
}: SideNavProps) {
  function refreshPage() {
    if (typeof window === "undefined") {
      return;
    }
    window.location.reload();
  }

  return (
    <aside className="side-nav panel">
      <button type="button" className="brand-lockup brand-lockup-button" onClick={refreshPage}>
        <svg className="brand-mark" viewBox="0 0 120 40" aria-hidden="true">
          <path d="M8 34H22V10H8V34ZM98 34H112V10H98V34Z" />
          <path d="M22 18C32 8 44 4 60 4C76 4 88 8 98 18L94 22C84 13 74 10 60 10C46 10 36 13 26 22L22 18Z" />
          <path d="M20 25H100V30H20V25Z" />
          <path d="M30 25H35V34H30V25ZM46 25H51V34H46V25ZM62 25H67V34H62V25ZM78 25H83V34H78V25Z" />
        </svg>
        <h1 className="brand">pawmaq.com</h1>
      </button>
      <p className="brand-subtitle">Watch what people are posting right now.</p>
      <nav className="tab-list" aria-label="Feed tabs">
        <button
          className={activeTab === "following" ? "tab-button active" : "tab-button"}
          onClick={() => onTabChange("following")}
          type="button"
        >
          Following
        </button>
        <button
          className={activeTab === "world" ? "tab-button active" : "tab-button"}
          onClick={() => onTabChange("world")}
          type="button"
        >
          World
        </button>
      </nav>
    </aside>
  );
}
