import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
// Self-hosted variable fonts. Vercel ships GeistSans and the type research
// below is calibrated to it; a Google Fonts <link> would be a render-blocking
// third-party request and would break offline.
import "@fontsource-variable/geist"
import "@fontsource-variable/geist-mono"
import "./styles.css"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
