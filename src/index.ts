export interface Env {
  DB: D1Database;
  DISCORD_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APP_ID: string;
}

export default {} satisfies ExportedHandler<Env>;
