import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { LedgerPage } from "./LedgerPage";
import { TestLabPage } from "./TestLabPage";
import "./styles.css";

const pathname = typeof window !== "undefined" ? window.location.pathname.replace(/\/+$/, "") : "";
const renderLedgerPage = pathname === "/ledger";
const renderTestLabPage = pathname === "/test-lab";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {renderLedgerPage ? <LedgerPage /> : renderTestLabPage ? <TestLabPage /> : <App />}
  </StrictMode>
);
