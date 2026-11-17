const workspaceId = "550e8400-e29b-41d4-a716-446655440000";

export class WorkspaceService {
  private readonly workspaces = [
    {
      id: workspaceId,
      name: "Northstar Studio",
      plan: "enterprise",
      region: "us-west-2",
    },
  ];

  list() {
    return this.workspaces;
  }

  get(id: string) {
    return this.workspaces.find((workspace) => workspace.id === id);
  }
}
