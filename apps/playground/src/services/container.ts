import { IocContainer } from "@restfx/server";
import { fileURLToPath } from "node:url";
import { AttachmentService } from "./AttachmentService.js";
import { AuthService } from "./AuthService.js";
import { EjsTemplateEngine } from "./EjsTemplateEngine.js";
import { ProjectService } from "./ProjectService.js";
import { TaskService } from "./TaskService.js";
import { WorkspaceService } from "./WorkspaceService.js";

const defaultViewsDirectory = fileURLToPath(
  new URL("../../views/", import.meta.url),
);

export function createPlaygroundContainer(
  options: { viewsDirectory?: string } = {},
) {
  const viewsDirectory = options.viewsDirectory ?? defaultViewsDirectory;

  return new IocContainer()
    .registerSingleton(AttachmentService, () => new AttachmentService())
    .registerSingleton(AuthService, () => new AuthService())
    .registerSingleton(
      EjsTemplateEngine,
      () => new EjsTemplateEngine({ viewsDirectory }),
    )
    .registerSingleton(WorkspaceService, () => new WorkspaceService())
    .registerSingleton(ProjectService, () => new ProjectService())
    .registerSingleton(TaskService, () => new TaskService());
}
