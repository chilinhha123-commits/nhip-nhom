import React from "react";
import ReactDOM from "react-dom/client";
import { GoogleOAuthProvider } from "@react-oauth/google";
import App from "./App";
import "./styles.css";

const clientId = (window as Window & { __GOOGLE_CLIENT_ID__?: string }).__GOOGLE_CLIENT_ID__ || "";

function Root() {
  const [googleClientId, setGoogleClientId] = React.useState(clientId);
  React.useEffect(() => {
    fetch("/api/config")
      .then((response) => response.json())
      .then((config: { googleClientId?: string }) => setGoogleClientId(config.googleClientId || ""))
      .catch(() => undefined);
  }, []);
  return (
    <GoogleOAuthProvider clientId={googleClientId || "demo-client-id"}>
      <App />
    </GoogleOAuthProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
