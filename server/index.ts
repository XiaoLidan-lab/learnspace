import "dotenv/config";
import { createApp } from "./api";
createApp().listen(Number(process.env.PORT) || 3001, "127.0.0.1", () =>
  console.log("LearnSpace API: http://127.0.0.1:3001"),
);
