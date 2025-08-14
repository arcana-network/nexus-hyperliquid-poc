/// <reference types="vite/client" />

import { CA } from "@arcana/ca-sdk";

declare global {
  interface Window {
    nexus: CA;
    nexusCache: Map<string, any>;
  }
}
