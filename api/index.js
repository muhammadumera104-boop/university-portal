// Vercel serverless entry point. It serves the same Express app that `npm run dev` runs locally,
// so requests to /api/* on the deployed site reach the real routes.
import { app } from '../Back end/src/app.js';

export default app;
