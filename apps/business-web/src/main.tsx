import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { BusinessAuthProvider } from "./auth/BusinessAuthProvider";
import "./styles/business.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <BusinessAuthProvider><App /></BusinessAuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
