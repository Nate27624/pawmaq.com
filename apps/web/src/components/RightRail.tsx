interface TrendItem {
  label: string;
  velocity: string;
}

const trends: TrendItem[] = [
  { label: "#CreatorEconomy", velocity: "+31% today" },
  { label: "#StreetCinema", velocity: "+21% today" },
  { label: "#GlobalClips", velocity: "+19% today" },
  { label: "#ShortDocs", velocity: "+16% today" }
];

export function RightRail() {
  return (
    <aside className="panel right-rail reveal">
      <h2>Trending</h2>
      <ul>
        {trends.map((trend) => (
          <li key={trend.label}>
            <span>{trend.label}</span>
            <strong>{trend.velocity}</strong>
          </li>
        ))}
      </ul>
      <div className="right-rail__note">
        <h3>Ranking Rules</h3>
        <p>World ranking follows your selected time window and sort mode from User settings.</p>
      </div>
    </aside>
  );
}
