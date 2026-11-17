import { createReviewRequestEnvironmentAtoms } from "@t3tools/client-runtime/state/review-requests";

import { connectionAtomRuntime } from "../connection/runtime";

export const reviewRequestEnvironment = createReviewRequestEnvironmentAtoms(connectionAtomRuntime);
