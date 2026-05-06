import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aiRouter from "./ai";
import githubRouter from "./github";
import agentRouter from "./agent";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/ai", aiRouter);
router.use("/github", githubRouter);
router.use("/agent", agentRouter);

export default router;
