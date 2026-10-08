import {
  createInitialOwnerInput,
  type InitialSetupState,
} from "@contracts/initialSetup";
import { anonymousQuery, createRouter } from "../middleware";
import {
  getDeploymentMode,
  requireBusinessDeployment,
} from "../lib/deployment";
import { createInitialOwner, readInitialSetupState } from "../lib/initialSetup";

export const initialSetupRouter = createRouter({
  state: anonymousQuery.query(
    (): Promise<InitialSetupState> | InitialSetupState => {
      if (getDeploymentMode() !== "business")
        return {
          needsOwner: false,
          canCreateOwner: false,
          requiresInstallationCode: false,
        };
      return readInitialSetupState();
    }
  ),
  createOwner: anonymousQuery
    .input(createInitialOwnerInput)
    .mutation(({ ctx, input }) => {
      requireBusinessDeployment();
      return createInitialOwner(input, ctx.req);
    }),
});
