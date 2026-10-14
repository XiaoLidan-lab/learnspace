import { createApp } from "../server/api";
// Vercel owns the listener; static assets are served by the Vite deployment.
export default createApp({}, { serveFrontend: false });
