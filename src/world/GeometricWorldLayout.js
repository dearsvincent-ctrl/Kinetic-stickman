import { box, pole, TRAVERSAL_STRUCTURES } from "./TraversalGeometry.js";

export const WORLD_ZONES = Object.freeze({
  city: Object.freeze({
    name: "Block city",
    minX: -460,
    maxX: -100,
    minZ: -480,
    maxZ: -70,
  }),
  jungle: Object.freeze({
    name: "Geometric jungle",
    minX: 100,
    maxX: 470,
    minZ: -470,
    maxZ: -70,
  }),
});
const styled = (surface, zone, style) =>
  Object.freeze({ ...surface, zone, style });

/** Fixed composition, built once. Every building, canopy, branch and bridge is
 * also a solid traversal surface; no random generation or per-frame scenery. */
export function createWorldLayout() {
  const city = [],
    jungle = [];
  const cityBox = (
    id,
    x,
    z,
    w,
    h,
    d,
    bottom = 0,
    vault = false,
    style = "city",
  ) => city.push(styled(box(id, x, z, w, h, d, vault, bottom), "city", style));
  for (const [id, x, z, w, h, d] of [
    ["city-entry", -130, -106, 20, 14, 22],
    ["city-alley-east", -163, -108, 14, 38, 30],
    ["city-alley-west", -187, -108, 20, 62, 30],
    ["city-step-a", -130, -143, 20, 22, 20],
    ["city-step-b", -130, -177, 20, 34, 24],
    ["city-court-west", -245, -137, 30, 48, 32],
    ["city-court-north", -224, -209, 30, 78, 26],
    ["city-west-block", -300, -110, 32, 95, 36],
    ["city-west-spire", -368, -120, 24, 180, 30],
    ["city-roof-a", -302, -222, 34, 42, 34],
    ["city-roof-b", -350, -222, 34, 42, 34],
    ["city-high-a", -235, -295, 28, 110, 32],
    ["city-high-b", -281, -295, 28, 110, 32],
    ["city-monolith", -365, -330, 44, 320, 44],
    ["city-needle", -303, -402, 22, 260, 28],
    ["city-deep-block", -418, -425, 32, 135, 36],
    ["city-east-tower", -150, -310, 30, 145, 30],
    ["city-east-block", -160, -402, 40, 58, 42],
    ["city-south-step", -225, -432, 26, 95, 28],
    ["city-low-island", -410, -220, 26, 24, 30],
  ])
    cityBox(id, x, z, w, h, d);
  cityBox("city-entry-vault", -130, -82, 9, 0.85, 0.8, 0, true, "barrier");
  cityBox("city-roof-bridge", -326, -222, 14, 1.2, 6, 40.8, false, "bridge");
  cityBox("city-high-bridge", -258, -295, 18, 1.4, 5, 108.6, false, "bridge");
  cityBox("city-balcony", -342, -322, 10, 1.4, 20, 90, false, "bridge");
  cityBox("city-elevated-stage", -220, -169, 16, 1.4, 16, 8, false, "bridge");
  for (let i = 0; i < 4; i++) {
    cityBox(
      `city-court-vault-${i}`,
      -205 - i * 13,
      -177,
      7,
      0.7 + i * 0.1,
      0.8,
      0,
      true,
      "barrier",
    );
    city.push(
      styled(
        pole(`city-perch-${i}`, -110 - i * 18, -218, 0.35, 12 + i * 7),
        "city",
        "pole",
      ),
    );
  }
  const trees = [
    [135, -110, 38],
    [191, -112, 62],
    [251, -105, 84],
    [315, -125, 52],
    [398, -112, 110],
    [155, -184, 92],
    [216, -192, 128],
    [279, -185, 72],
    [350, -197, 148],
    [422, -190, 90],
    [132, -276, 68],
    [199, -274, 112],
    [262, -275, 160],
    [331, -286, 94],
    [405, -282, 130],
    [157, -378, 120],
    [224, -383, 82],
    [291, -385, 140],
    [361, -383, 108],
    [428, -389, 172],
  ];
  for (const [i, [x, z, h]] of trees.entries()) {
    const width = 7 + (i % 3),
      wing = 15 + (i % 4);
    jungle.push(
      styled(
        box(`jungle-trunk-${i}`, x, z, width, h, width),
        "jungle",
        "trunk",
      ),
    );
    // Split crowns leave a continuous, clear front/back climbing channel.
    // Their tops sit below the trunk perch and connect via jumpable branches.
    for (const sign of [-1, 1]) {
      jungle.push(
        styled(
          box(
            `jungle-crown-${i}-${sign}`,
            x + sign * (width / 2 + 4 + wing / 2),
            z,
            wing,
            8,
            26,
            false,
            h - 12,
          ),
          "jungle",
          "canopy",
        ),
      );
      jungle.push(
        styled(
          box(
            `jungle-branch-${i}-${sign}`,
            x + sign * (width / 2 + 7),
            z,
            14,
            1.2,
            3,
            false,
            h * (sign < 0 ? 0.42 : 0.67),
          ),
          "jungle",
          "branch",
        ),
      );
    }
  }
  for (let i = 0; i < 6; i++)
    jungle.push(
      styled(
        pole(`jungle-perch-${i}`, 116 + i * 18, -155, 0.4, 16 + i * 5),
        "jungle",
        "pole",
      ),
    );
  jungle.push(
    styled(
      box("jungle-entry-vault", 135, -88, 8, 0.8, 0.8, true),
      "jungle",
      "branch",
    ),
  );
  jungle.push(
    styled(
      box("jungle-canopy-crossing", 245, -275, 18, 1.2, 5, false, 100),
      "jungle",
      "branch",
    ),
  );
  return Object.freeze([...city, ...jungle]);
}
export const GEOMETRIC_WORLD_STRUCTURES = createWorldLayout();
export const ALL_TRAVERSAL_STRUCTURES = Object.freeze([
  ...TRAVERSAL_STRUCTURES,
  ...GEOMETRIC_WORLD_STRUCTURES,
]);
export function worldZoneAt(position) {
  for (const zone of Object.values(WORLD_ZONES))
    if (
      position.x >= zone.minX &&
      position.x <= zone.maxX &&
      position.z >= zone.minZ &&
      position.z <= zone.maxZ
    )
      return zone.name;
  return "Open training arena";
}
