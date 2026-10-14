import { createApp } from "../server/api.js";
// Vercel owns the listener; static assets are served by the Vite deployment.
export default createApp({}, { serveFrontend: false });
