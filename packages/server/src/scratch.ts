import { HttpResource } from "./decorators/HttpResource.js";
import { HttpDelete } from "./decorators/HttpMethod.js";
import { HttpContext } from "./HttpContext.js";

export class PostsResource {
  @HttpDelete()
  async deletePost(ctx: HttpContext) {}
}

@HttpResource("api")
export class BlogApi {
  @HttpResource()
  static readonly posts = new PostsResource();
}
