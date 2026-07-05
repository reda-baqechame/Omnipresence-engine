import { describe, expect, it } from "vitest";
import { captureOptionsFromLocation, locationToGeo } from "@/lib/providers/location-geo";

describe("locationToGeo", () => {
  it("maps country names to ISO codes", () => {
    expect(locationToGeo("Germany")).toBe("DE");
    expect(locationToGeo("United States")).toBe("US");
    expect(locationToGeo("Canada")).toBe("CA");
  });

  it("extracts country from city, country strings", () => {
    expect(locationToGeo("Toronto, Canada")).toBe("CA");
    expect(locationToGeo("Berlin, Germany")).toBe("DE");
  });

  it("passes through two-letter codes", () => {
    expect(locationToGeo("DE")).toBe("DE");
  });

  it("defaults unknown locations to US", () => {
    expect(locationToGeo("")).toBe("US");
    expect(locationToGeo("Atlantis")).toBe("US");
  });
});

describe("captureOptionsFromLocation", () => {
  it("derives geo and locale for capture requests", () => {
    expect(captureOptionsFromLocation("Germany")).toEqual({ geo: "DE", locale: "en-DE" });
  });
});
