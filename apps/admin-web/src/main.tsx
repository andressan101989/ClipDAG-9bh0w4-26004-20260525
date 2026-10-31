import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AdminAuthProvider } from "./auth/AdminAuthProvider";
import { AdminErrorBoundary } from "./components/AdminErrorBoundary";
import "./styles/admin.css";
import "./styles/operations.css";

createRoot(document.getElementById("root")!).render(<StrictMode><BrowserRouter basename="/admin"><AdminErrorBoundary><AdminAuthProvider><App/></AdminAuthProvider></AdminErrorBoundary></BrowserRouter></StrictMode>);
