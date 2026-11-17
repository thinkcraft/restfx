import { IocContainer } from "@framework/server";
import { AttachmentService } from "./AttachmentService.js";
import { AuthService } from "./AuthService.js";
import { ProjectService } from "./ProjectService.js";
import { TaskService } from "./TaskService.js";
import { WorkspaceService } from "./WorkspaceService.js";

export function createPlaygroundContainer() {
  return new IocContainer()
    .registerSingleton(AttachmentService, () => new AttachmentService())
    .registerSingleton(AuthService, () => new AuthService())
    .registerSingleton(WorkspaceService, () => new WorkspaceService())
    .registerSingleton(ProjectService, () => new ProjectService())
    .registerSingleton(TaskService, () => new TaskService());
}
