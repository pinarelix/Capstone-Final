using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Barangay179.Native;

public sealed class RecordModel(JsonObject data)
{
    public JsonObject Data { get; } = data;
    public string Text(string field) => Data[field] is JsonValue value && value.TryGetValue<string>(out var text) ? text : Data[field]?.ToJsonString() ?? "";
    public double Number(string field) => double.TryParse(Text(field), NumberStyles.Float, CultureInfo.InvariantCulture, out var result) ? result : 0;
    public int Id => (int)Number("id");
    public double Score => Number("cart_score");
    public string NumberLabel => Text("blotter_number");
    public string Type => Text("incident_type");
    public bool IsIncident => Text("form_type") == "crime";
    public string Source => IsIncident ? "Incident" : "Blotter";
    public string Address => string.IsNullOrWhiteSpace(Text("address")) ? Text("street_name") : Text("address");
    public string Heading => $"{NumberLabel} · CART {Score:F2} · {Type}";
    public string Subheading => $"{Source} · {Address}";
    public bool Synthetic => Text("data_origin") == "synthetic";
    public IEnumerable<(string Label, string Value)> People()
    {
        string Name(string prefix, string fallback) {
            var name = string.Join(" ", new[] { Text(prefix + "_first"), Text(prefix + "_middle"), Text(prefix + "_last") }.Where(x => !string.IsNullOrWhiteSpace(x)));
            return string.IsNullOrWhiteSpace(name) ? Text(fallback) : name;
        }
        if (IsIncident) {
            yield return ("Reporter", Name("reporter", "reported_by_name"));
            yield return ("Reporter address", Text("reporter_address"));
            yield return ("Reporter contact", Text("reporter_contact"));
        } else {
            yield return ("Complainant", Name("complainant", "reported_by_name"));
            yield return ("Complainant contact", Text("complainant_contact"));
            yield return ("Respondent", Name("respondent", "respondent_name"));
            yield return ("Respondent address", Text("respondent_address"));
        }
        yield return ("Encoded by", Text("reporter_name"));
    }
    public static bool ValidNotes(string notes) => notes.Length <= 200 && !Regex.IsMatch(notes, "[<>\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]");
}

public static class BarangayBoundary
{
    // Same [longitude, latitude] polygon as frontend/barangay-boundary.js.
    // A repository contract test checks that these stay synchronized.
    public static readonly (double Lng, double Lat)[] Points = [
        (121.068181,14.759055),(121.081208,14.758775),(121.081317,14.754012),
        (121.084781,14.753785),(121.084528,14.751778),(121.083159,14.749692),
        (121.081282,14.749858),(121.081271,14.746963),(121.078353,14.745345),
        (121.077591,14.742305),(121.075112,14.740230),(121.073074,14.741330),
        (121.072044,14.740354),(121.068793,14.740365),(121.068825,14.739151),
        (121.067227,14.739182),(121.067320,14.758127),(121.067813,14.758158),
        (121.068181,14.759055)
    ];
    public static bool Contains(double lat, double lng) {
        if (!double.IsFinite(lat) || !double.IsFinite(lng)) return false;
        bool inside = false;
        for (int i = 0, j = Points.Length - 1; i < Points.Length; j = i++) {
            var a = Points[i]; var b = Points[j];
            if ((a.Lat > lat) != (b.Lat > lat) && lng < (b.Lng - a.Lng) * (lat - a.Lat) / (b.Lat - a.Lat) + a.Lng) inside = !inside;
        }
        return inside;
    }
}
