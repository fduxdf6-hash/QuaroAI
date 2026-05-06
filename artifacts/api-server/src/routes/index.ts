import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aiRouter from "./ai";
import githubRouter from "./github";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/ai", aiRouter);
router.use("/github", githubRouter);

export default router;
