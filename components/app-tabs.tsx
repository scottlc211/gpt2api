"use client";

import Link from "next/link";
import type { CSSProperties } from "react";

export function AppTabs({ activeTab }: { activeTab: "chat" | "workbench" }) {
  return (
    <nav style={navStyle} aria-label="应用页面切换">
      <Link href="/" style={{ ...tabStyle, ...(activeTab === "chat" ? activeTabStyle : inactiveTabStyle) }}>
        对话生图
      </Link>
      <Link href="/products" style={{ ...tabStyle, ...(activeTab === "workbench" ? activeTabStyle : inactiveTabStyle) }}>
        商品工作台
      </Link>
    </nav>
  );
}

const navStyle: CSSProperties = {
  display: "inline-flex",
  gap: 8,
  alignItems: "center",
  padding: 8,
  borderRadius: 999,
  background: "rgba(255,255,255,0.88)",
  border: "1px solid rgba(231,229,228,0.96)",
  boxShadow: "0 12px 30px rgba(41, 37, 36, 0.08)",
  backdropFilter: "blur(10px)",
};

const tabStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 999,
  padding: "10px 16px",
  fontSize: 14,
  fontWeight: 600,
  transition: "all 160ms ease",
  cursor: "pointer",
};

const activeTabStyle: CSSProperties = {
  background: "linear-gradient(135deg, #171717, #2b2b2b)",
  color: "white",
  boxShadow: "0 10px 18px rgba(23, 23, 23, 0.2)",
};

const inactiveTabStyle: CSSProperties = {
  background: "transparent",
  color: "#44403c",
  border: "1px solid transparent",
};
