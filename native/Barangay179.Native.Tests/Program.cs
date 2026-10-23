using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Barangay179.Native;

int passed = 0;
void Check(bool condition, string name) { if (!condition) throw new Exception("FAILED: " + name); Console.WriteLine("PASS: " + name); passed++; }
void Reject(Action action, string name) { bool rejected = false; try { action(); } catch (ArgumentException) { rejected = true; } Check(rejected, name); }

Check(ApiClient.ValidateServer("http://localhost:3007").AbsoluteUri == "http://localhost:3007/api/", "local API address");
Check(ApiClient.ValidateServer("https://office-server:3007").Scheme == "https", "HTTPS office server");
Reject(() => ApiClient.ValidateServer("http://192.168.1.10:3007"), "LAN HTTP requires acknowledgement");
Check(ApiClient.ValidateServer("http://192.168.1.10:3007", true).Host == "192.168.1.10", "explicit LAN HTTP option");
foreach (string address in new[] { "file:///C:/app", "https://name:secret@office-server", "https://office-server/api", "https://office-server/?token=secret", "https://office-server/#fragment" })
    Reject(() => ApiClient.ValidateServer(address), "invalid server address " + address.Split('@').Last());
Check(RecordModel.ValidNotes(new string('x', 200)), "200-character notes boundary");
Check(!RecordModel.ValidNotes(new string('x', 201)), "oversized notes rejected");
Check(!RecordModel.ValidNotes("<script>alert(1)</script>") && !RecordModel.ValidNotes("a\0b"), "markup and control characters rejected");
Check(RecordModel.ValidNotes("O'Brien — reassess tomorrow\nCheck lighting"), "plain text, Unicode and line breaks preserved");
Check(RecordModel.ValidNotes("'; DROP TABLE records; --"), "SQL-shaped plain text remains text; API uses parameterized SQL");
var incident = new RecordModel(JsonNode.Parse("""{"id":7,"form_type":"crime","reporter_first":"Incident","reporter_last":"Reporter","reported_by_name":"Blotter Person","respondent_name":"Other Person","cart_score":"67.03"}""")!.AsObject());
Check(incident.Id == 7 && incident.Score == 67.03, "numeric string score conversion");
Check(incident.People().Any(person => person.Label == "Reporter" && person.Value == "Incident Reporter"), "incident uses its structured reporter");
Check(!incident.People().Any(person => person.Label.Contains("Complainant") || person.Label.Contains("Respondent")), "incident never shows blotter parties");
var blotter = new RecordModel(JsonNode.Parse("""{"form_type":"blotter","reported_by_name":"QA Complainant","respondent_name":"QA Respondent"}""")!.AsObject());
Check(blotter.People().Any(person => person.Label == "Complainant" && person.Value == "QA Complainant") && blotter.People().Any(person => person.Label == "Respondent"), "blotter parties retained");
Check(BarangayBoundary.Contains(14.749, 121.075) && !BarangayBoundary.Contains(14.70, 121.01) && !BarangayBoundary.Contains(double.NaN, 121.075), "boundary containment and invalid coordinates");

var handler = new FakeHandler();
using var api = new ApiClient("http://localhost:3007", handler: handler);
await api.LoginAsync("qa", "fictional-password");
Check(api.CanEdit && api.Role == "Executive Officer", "legacy deputy role normalized");
await api.SendAsync(HttpMethod.Get, "heatmap/records");
Check(handler.LastAuthorization == "Bearer fictional-test-session" && handler.LastPath == "/api/heatmap/records", "existing API bearer-session contract");
bool routeRejected = false;
try { await api.SendAsync(HttpMethod.Get, "https://unrelated-server/collect"); } catch (ArgumentException) { routeRejected = true; }
Check(routeRejected, "cannot forward bearer token to an absolute route");
handler.Status = HttpStatusCode.Forbidden;
bool permissionRejected = false;
try { await api.SendAsync(HttpMethod.Patch, "incidents/7/patrol-details", new JsonObject { ["patrol_notes"] = "test" }); } catch (ApiException error) { permissionRejected = error.Status == HttpStatusCode.Forbidden; }
Check(permissionRejected, "server-side authorization failure propagated");
handler.Status = HttpStatusCode.OK;
await api.LogoutAsync();
Check(!api.CanEdit && api.Role == "", "sign-out clears client permissions");
await api.SendAsync(HttpMethod.Get, "heatmap/records");
Check(handler.LastAuthorization == "", "sign-out clears in-memory bearer token");
Console.WriteLine($"{passed} native contract checks passed. No database connections or writes were made.");

sealed class FakeHandler : HttpMessageHandler {
    public string LastAuthorization = "", LastPath = "";
    public HttpStatusCode Status = HttpStatusCode.OK;
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) {
        LastAuthorization = request.Headers.Authorization?.ToString() ?? ""; LastPath = request.RequestUri!.AbsolutePath;
        string json = Status == HttpStatusCode.Forbidden ? """{"error":"Permission denied"}""" : LastPath.EndsWith("auth/login") ?
            """{"session_token":"fictional-test-session","user":{"name":"QA Account","role":"Deputy Officer"}}""" : "{}";
        return Task.FromResult(new HttpResponseMessage(Status) { Content = new StringContent(json, Encoding.UTF8, "application/json") });
    }
}
