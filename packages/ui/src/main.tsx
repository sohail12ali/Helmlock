import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { AppRoutes, makeQueryClient, Providers } from "./App";
import "./index.css";

const client = makeQueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Providers client={client}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </Providers>
  </StrictMode>,
);
