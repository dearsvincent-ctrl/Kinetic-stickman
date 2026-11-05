/** Resolve the standard GitHub Pages URL from GitHub Actions metadata.
 * Local builds keep relative URLs, preserving other static-host deployments.
 * User/organization sites live at /; project sites live at /repository-name/.
 */
export function resolvePagesBase(environment = process.env) {
  if (environment.GITHUB_PAGES !== "true") return "./";

  const repository = environment.GITHUB_REPOSITORY ?? "";
  if (!/^[a-z\d_.-]+\/[a-z\d_.-]+$/i.test(repository)) {
    throw new Error(
      "A Pages build requires GITHUB_REPOSITORY in owner/repository form.",
    );
  }
  const [owner, name] = repository.split("/");
  if (name === "." || name === "..") {
    throw new Error("Invalid GitHub Pages repository name.");
  }
  return name.toLowerCase() === `${owner}.github.io`.toLowerCase()
    ? "/"
    : `/${name}/`;
}
