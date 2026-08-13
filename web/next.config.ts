import type { NextConfig } from "next";

const config: NextConfig = {
  // shared/ ships raw TypeScript rather than a build artifact — one less build
  // step, and the server consumes the same source via tsx.
  transpilePackages: ["@wtoffice/shared"],
};

export default config;
