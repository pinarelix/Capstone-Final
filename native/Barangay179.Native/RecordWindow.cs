using System.Net.Http;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace Barangay179.Native;

public sealed class RecordWindow : Window
{
    private readonly ApiClient api;
    private readonly ListBox list = new() { DisplayMemberPath = "Heading" };
    private readonly StackPanel detail = new() { Margin = new Thickness(24) };
    private readonly TextBlock status = new() { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(24,8,24,20) };
    private int request;
    private bool dirty, saving, restoringSelection;
    private RecordModel? current;
    public RecordWindow(ApiClient api, List<RecordModel> rows) {
        this.api = api; Title = "Record details"; Width = 1100; Height = 780; MinWidth = 850; MinHeight = 600;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        var grid = new Grid(); grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(280) }); grid.ColumnDefinitions.Add(new ColumnDefinition());
        list.ItemsSource = rows.OrderByDescending(row => row.Score).ThenBy(row => row.Id).ToList(); list.SelectedIndex = 0;
        list.Margin = new Thickness(12); System.Windows.Automation.AutomationProperties.SetName(list, "Location records by descending CART score");
        grid.Children.Add(list);
        var right = new DockPanel(); Grid.SetColumn(right, 1); grid.Children.Add(right);
        DockPanel.SetDock(status, Dock.Bottom); right.Children.Add(status); right.Children.Add(new ScrollViewer { Content = detail, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
        Content = grid;
        list.SelectionChanged += async (_,_) => {
            if (restoringSelection) return;
            if (dirty && !ConfirmDiscard()) {
                restoringSelection = true; list.SelectedItem = current; restoringSelection = false; return;
            }
            try { await LoadSelectedAsync(); } catch (Exception error) { detail.Children.Clear(); status.Text = error.Message; }
        };
        Closing += (_, args) => {
            if (saving) { args.Cancel = true; status.Text = "Please wait for the save request to finish."; }
            else if (dirty && !ConfirmDiscard()) args.Cancel = true;
        };
        Closed += (_,_) => request++;
    }
    public async Task LoadSelectedAsync() {
        if (list.SelectedItem is not RecordModel row) return;
        int version = ++request; current = row; dirty = false; detail.Children.Clear(); status.Text = "Loading record…";
        list.IsEnabled = false;
        JsonObject data;
        try { data = (await api.SendAsync(HttpMethod.Get, $"incidents/{row.Id}")).AsObject(); }
        finally { list.IsEnabled = true; }
        if (version != request) return;
        data["cart_score"] = row.Score;
        var record = new RecordModel(data); status.Text = "";
        Heading(record.NumberLabel + " · " + record.Source);
        Field("CART score", row.Score.ToString("F2"));
        if (record.Synthetic) Field("Test data", "SYNTHETIC TEST RECORD — fictional event and people.");
        Heading("Incident details");
        foreach (var field in new[] { ("Type","incident_type"),("Subjective severity indication","severity"),("Date","date"),("Time","time"),("Case status","status") }) Field(field.Item1, record.Text(field.Item2));
        Heading("Incident location"); Field("Exact address", record.Address);
        Field("Coordinates", record.Text("latitude") + ", " + record.Text("longitude"));
        Heading(record.IsIncident ? "Reporter information" : "Parties involved"); foreach (var person in record.People()) Field(person.Label, person.Value);
        Heading("Description and recommended action"); Field("Description", record.Text("description")); Field("Recommended action", record.Text("recommended_action"));
        Heading("Linked patrol schedules");
        var linked = data["linked_patrols"] as JsonArray;
        Field("Schedules", linked is {Count: > 0} ? string.Join("\n", linked.OfType<JsonObject>().Select(schedule => $"{schedule["scheduled_date"] ?? schedule["day_of_week"]}: {schedule["status"]} · {schedule["assigned_tanods"]}")) : "No linked patrol schedules");
        Heading("Patrol notes");
        var notes = new TextBox { Text = record.Text("patrol_notes"), MaxLength = 200, AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MinHeight = 90, IsReadOnly = !api.CanEdit };
        System.Windows.Automation.AutomationProperties.SetName(notes, "Patrol notes, maximum 200 characters");
        var count = new TextBlock { Text = $"{notes.Text.Length} / 200 characters", Foreground = Brushes.SlateGray };
        notes.TextChanged += (_,_) => { count.Text = $"{notes.Text.Length} / 200 characters"; dirty = notes.Text != record.Text("patrol_notes"); };
        detail.Children.Add(notes); detail.Children.Add(count);
        if (api.CanEdit) {
            var save = new Button { Content = "Save patrol notes", HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0,14,0,8) };
            save.Click += async (_,_) => {
                if (!RecordModel.ValidNotes(notes.Text)) { status.Text = "Notes must be plain text, at most 200 characters, without angle brackets or control characters."; return; }
                save.IsEnabled = false; list.IsEnabled = false; saving = true;
                var savedText = notes.Text; notes.IsReadOnly = true;
                try { await api.SendAsync(HttpMethod.Patch, $"incidents/{record.Id}/patrol-details", new JsonObject { ["patrol_notes"] = savedText }); record.Data["patrol_notes"] = savedText; dirty = false; status.Text = "Patrol notes saved to the record."; }
                catch (Exception error) { status.Text = error.Message; }
                finally { save.IsEnabled = true; list.IsEnabled = true; saving = false; notes.IsReadOnly = false; }
            };
            detail.Children.Add(save);
        }
        Field("Migration status", "Full record editing, patrol scheduling, assignment and evidence workflows remain in the existing application. This native preview does not replace them yet.");
    }
    private bool ConfirmDiscard() => MessageBox.Show(this, "Discard unsaved patrol notes?", "Unsaved changes", MessageBoxButton.YesNo, MessageBoxImage.Question, MessageBoxResult.No) == MessageBoxResult.Yes;
    private void Heading(string text) => detail.Children.Add(new TextBlock { Text = text, Style = (Style)FindResource("Section") });
    private void Field(string label, string value) {
        detail.Children.Add(new TextBlock { Text = label.ToUpperInvariant(), FontSize = 11, FontWeight = FontWeights.SemiBold, Foreground = Brushes.SlateGray, Margin = new Thickness(0,8,0,3) });
        detail.Children.Add(new TextBox { Text = string.IsNullOrWhiteSpace(value) ? "Not recorded" : value, IsReadOnly = true, TextWrapping = TextWrapping.Wrap, BorderThickness = new Thickness(0), Background = Brushes.White, Padding = new Thickness(0), Margin = new Thickness(0,0,0,8) });
    }
}
