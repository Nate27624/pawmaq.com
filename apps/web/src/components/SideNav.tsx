import type { FeedTab } from "../types";

interface SideNavProps {
  activeTab: FeedTab;
  onTabChange: (tab: FeedTab) => void;
}

export function SideNav({ activeTab, onTabChange }: SideNavProps) {
  return (
    <aside className="side-nav panel">
      <h1 className="brand">Pawmaq</h1>
      <p className="brand-subtitle">Signals, clips, and community context.</p>
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
        <button
          className={activeTab === "controversial" ? "tab-button active" : "tab-button"}
          onClick={() => onTabChange("controversial")}
          type="button"
        >
          Controversial
        </button>
      </nav>
      <div className="side-note">
        <p>World ranks by popularity and country support. Controversial ranks by conflict and awful votes.</p>
      </div>
    </aside>
  );
}
