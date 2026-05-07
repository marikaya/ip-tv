import React from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider, theme } from "antd";
import "antd/dist/reset.css";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        algorithm: [theme.darkAlgorithm, theme.compactAlgorithm],
        token: {
          colorPrimary: "#38bdf8",
          colorBgBase: "#020617",
          colorBgContainer: "#0f172a",
          colorBorder: "rgba(148, 163, 184, 0.18)",
          borderRadius: 12,
          fontFamily: "Inter, system-ui, sans-serif"
        }
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>
);
