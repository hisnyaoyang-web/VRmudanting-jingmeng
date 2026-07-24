"use client";

import { SSRProvider } from "@webspatial/react-sdk";
import { useEffect, type ReactNode } from "react";

export default function SpatialProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const isSpatialRuntime = navigator.userAgent.includes("WebSpatial/");
    document.documentElement.classList.toggle("is-spatial", isSpatialRuntime);
    return () => document.documentElement.classList.remove("is-spatial");
  }, []);

  return <SSRProvider>{children}</SSRProvider>;
}
