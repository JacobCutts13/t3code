import { createFileRoute } from "@tanstack/react-router";

import { IssuesPage } from "../components/issues/IssuesPage";

export const Route = createFileRoute("/_chat/issues")({
  component: IssuesPage,
});
