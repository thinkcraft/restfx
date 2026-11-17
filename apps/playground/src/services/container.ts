import { IocContainer } from "@framework/server";
import { ProjectService } from "./ProjectService.js";
import { TaskService } from "./TaskService.js";
import { WorkspaceService } from "./WorkspaceService.js";

export function createPlaygroundContainer() {
  return new IocContainer()
    .registerSingleton(WorkspaceService, () => new WorkspaceService())
    .registerSingleton(ProjectService, () => new ProjectService())
    .registerSingleton(TaskService, () => new TaskService());
}
