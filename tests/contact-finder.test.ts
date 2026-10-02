import { describe, expect, it } from "vitest";
import { contactLinks, emailsIn, fetchOwnPage, isPublicAddress } from "@/server/campaigns/contact-finder";
import { cleanPhone } from "@/server/dataforseo/market";

describe("finding a business's published email", () => {
  it("never reaches private or internal addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect([ip, isPublicAddress(ip)]).toEqual([ip, false]);
    }
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("2606:4700::1111")).toBe(true);
  });

  it("only fetches pages on the business's own domain", async () => {
    expect(await fetchOwnPage("https://evil.example/", "acme.ca")).toBeNull();
    expect(await fetchOwnPage("http://127.0.0.1/", "acme.ca")).toBeNull();
    expect(await fetchOwnPage("https://acme.ca:8443/", "acme.ca")).toBeNull();
    expect(await fetchOwnPage("file:///etc/passwd", "acme.ca")).toBeNull();
    expect(await fetchOwnPage("https://user:pw@acme.ca/", "acme.ca")).toBeNull();
  });

  it("picks real addresses, the business's own domain first", () => {
    const html = `<a href="mailto:Info@Acme.ca">Email</a> logo@2x.png  owner@gmail.com  test@example.com  noreply@acme.ca  sales&#64;acme.ca`;
    expect(emailsIn(html, "acme.ca")).toEqual(["info@acme.ca", "sales@acme.ca", "owner@gmail.com"]);
  });

  it("finds the contact page link on the same site only", () => {
    const html = `<a href="/about">About</a><a href="/contact-us">Contact</a><a href="https://other.com/contact">x</a>`;
    expect(contactLinks(html, "https://acme.ca/", "acme.ca")).toEqual(["https://acme.ca/contact-us", "https://acme.ca/about"]);
  });

  it("keeps plausible phone numbers only", () => {
    expect(cleanPhone("+1 905-457-1684")).toBe("+1 905-457-1684");
    expect(cleanPhone("call us!")).toBeNull();
    expect(cleanPhone(null)).toBeNull();
  });
});
