using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;

namespace Barangay179.Native;

public sealed class ApiException(string message, HttpStatusCode status) : Exception(message) {
    public HttpStatusCode Status { get; } = status;
}

public sealed class ApiClient : IDisposable
{
    private readonly HttpClient client;
    public string Role { get; private set; } = "";
    public string UserName { get; private set; } = "";
    public bool CanEdit => Role == "Executive Officer";
    public ApiClient(string server, bool allowPlaintextLan = false, HttpMessageHandler? handler = null) {
        var baseUri = ValidateServer(server, allowPlaintextLan);
        client = new HttpClient(handler ?? new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false }) {
            BaseAddress = baseUri, Timeout = TimeSpan.FromSeconds(20)
        };
    }
    public static Uri ValidateServer(string server, bool allowPlaintextLan = false) {
        if (!Uri.TryCreate(server.Trim(), UriKind.Absolute, out var uri) || (uri.Scheme != "https" && uri.Scheme != "http") ||
            !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment) || uri.AbsolutePath != "/")
            throw new ArgumentException("Enter a server origin only, for example https://barangay-server:3007 (no /api path).");
        if (uri.Scheme == "http" && !uri.IsLoopback && !allowPlaintextLan)
            throw new ArgumentException("Use HTTPS for LAN connections, or explicitly acknowledge the insecure HTTP LAN option.");
        return new Uri(uri, "api/");
    }
    public async Task LoginAsync(string username, string password) {
        var result = await SendAsync(HttpMethod.Post, "auth/login", new JsonObject { ["username"] = username, ["password"] = password });
        var token = result["session_token"]?.GetValue<string>();
        if (string.IsNullOrWhiteSpace(token)) throw new InvalidOperationException("The server did not return a session token.");
        Role = result["user"]?["role"]?.GetValue<string>() ?? "";
        if (Role == "Deputy Officer") Role = "Executive Officer";
        UserName = result["user"]?["name"]?.GetValue<string>() ?? username;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
    }
    public async Task<JsonNode> SendAsync(HttpMethod method, string path, JsonNode? body = null) {
        if (path.StartsWith('/') || path.Contains("..") || Uri.TryCreate(path, UriKind.Absolute, out _)) throw new ArgumentException("Use a relative API route.");
        using var request = new HttpRequestMessage(method, path);
        if (body != null) request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        using var response = await client.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        JsonNode? result;
        try { result = JsonNode.Parse(text); } catch { result = null; }
        if (!response.IsSuccessStatusCode) throw new ApiException(result?["error"]?.ToString() ?? $"Server returned HTTP {(int)response.StatusCode}.", response.StatusCode);
        return result ?? throw new InvalidOperationException("The server returned an invalid JSON response.");
    }
    public async Task LogoutAsync() {
        try { await SendAsync(HttpMethod.Post, "auth/logout"); }
        finally { client.DefaultRequestHeaders.Authorization = null; Role = ""; UserName = ""; }
    }
    public void Dispose() => client.Dispose();
}
