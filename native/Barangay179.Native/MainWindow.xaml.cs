using System.Net;
using System.Net.Http;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;

namespace Barangay179.Native;

public partial class MainWindow : Window
{
    private ApiClient? api;
    private List<RecordModel> records = [];
    private List<RecordModel> visible = [];
    private double moderate = 34, high = 67;
    private bool busy;
    public MainWindow() { InitializeComponent(); }
    private async void Login_Click(object sender, RoutedEventArgs e) {
        if (busy) return;
        SetBusy(true); LoginStatus.Text = "Connecting…";
        try {
            api?.Dispose(); api = new ApiClient(ServerAddress.Text, AllowHttpLan.IsChecked == true);
            await api.LoginAsync(Username.Text.Trim(), Password.Password);
            Password.Clear(); LoginStatus.Text = "";
            LoginView.Visibility = Visibility.Collapsed; Workspace.Visibility = Visibility.Visible;
            AccountLabel.Text = api.UserName + "\n" + api.Role;
            await RefreshAsync();
        } catch (Exception error) { LoginStatus.Text = Friendly(error); api?.Dispose(); api = null; ShowLogin(); }
        finally { SetBusy(false); }
    }
    private void SetBusy(bool value) {
        busy = value; LoginButton.IsEnabled = !value; RefreshButton.IsEnabled = !value; OpenButton.IsEnabled = !value;
        ServerAddress.IsEnabled = !value; Username.IsEnabled = !value; Password.IsEnabled = !value;
    }
    private static string Friendly(Exception error) => error is TaskCanceledException ? "The internal server timed out. Check the server address and network." :
        error is HttpRequestException ? "Could not reach the internal server. Check that it is running and the address is correct." : error.Message;
    private async Task RefreshAsync() {
        if (api == null) return;
        var result = await api.SendAsync(HttpMethod.Get, "heatmap/records");
        moderate = ReadNumber(result["thresholds"]?["level2"], 34); high = ReadNumber(result["thresholds"]?["level3"], 67);
        records = (result["records"]?.AsArray() ?? []).OfType<JsonObject>().Select(row => new RecordModel(row))
            .Where(row => BarangayBoundary.Contains(row.Number("latitude"), row.Number("longitude")))
            .OrderByDescending(row => row.Score).ThenBy(row => row.Id).ToList();
        ThresholdLabel.Text = $"CART: Low < {moderate} · Moderate {moderate} to < {high} · High ≥ {high}";
        ApplyFilter();
    }
    private static double ReadNumber(JsonNode? node, double fallback) => double.TryParse(node?.ToString(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var number) ? number : fallback;
    private void ApplyFilter() {
        if (Search == null) return;
        var selected = (RecordsList.SelectedItem as RecordModel)?.Id;
        var query = Search.Text.Trim();
        visible = records.Where(row => (row.Heading + " " + row.Subheading).Contains(query, StringComparison.OrdinalIgnoreCase)).ToList();
        RecordsList.ItemsSource = visible; RecordsList.SelectedItem = visible.Find(row => row.Id == selected) ?? visible.FirstOrDefault();
        Status.Text = $"{visible.Count} records · highest CART score first. {visible.Count(row => row.Synthetic)} synthetic test records. Live refresh is manual in this preview.";
        DrawPins();
    }
    private void Search_Changed(object sender, TextChangedEventArgs e) => ApplyFilter();
    private async void Refresh_Click(object sender, RoutedEventArgs e) {
        if (busy) return; SetBusy(true);
        try { await RefreshAsync(); } catch (Exception error) { HandleError(error); } finally { SetBusy(false); }
    }
    private async void Logout_Click(object sender, RoutedEventArgs e) {
        if (busy || api == null) return; SetBusy(true);
        try { await api.LogoutAsync(); } catch { /* Local credentials are always cleared. */ }
        finally { api.Dispose(); api = null; records.Clear(); visible.Clear(); RecordsList.ItemsSource = null; PinCanvas.Children.Clear(); ShowLogin(); SetBusy(false); }
    }
    private void ShowLogin() { Workspace.Visibility = Visibility.Collapsed; LoginView.Visibility = Visibility.Visible; Password.Clear(); }
    private void HandleError(Exception error) {
        if (error is ApiException { Status: HttpStatusCode.Unauthorized }) {
            api?.Dispose(); api = null; records.Clear(); visible.Clear(); RecordsList.ItemsSource = null; PinCanvas.Children.Clear(); ShowLogin(); LoginStatus.Text = "Your session expired. Please sign in again.";
        } else Status.Text = Friendly(error);
    }
    private async void Records_Open(object sender, RoutedEventArgs e) { if (RecordsList.SelectedItem is RecordModel record) await OpenRecordsAsync([record]); }
    private void Records_KeyDown(object sender, KeyEventArgs e) { if (e.Key == Key.Enter) { e.Handled = true; Records_Open(sender, e); } }
    private async Task OpenRecordsAsync(List<RecordModel> group) {
        if (api == null || busy || group.Count == 0) return;
        SetBusy(true);
        try {
            var dialog = new RecordWindow(api, group) { Owner = this };
            await dialog.LoadSelectedAsync(); dialog.ShowDialog();
            await RefreshAsync();
        } catch (Exception error) { HandleError(error); }
        finally { SetBusy(false); }
    }
    private void Navigation_Changed(object sender, RoutedEventArgs e) {
        if (MapView == null) return;
        bool showMap = MapNav.IsChecked == true;
        MapView.Visibility = showMap ? Visibility.Visible : Visibility.Collapsed;
        RecordsList.Visibility = showMap ? Visibility.Collapsed : Visibility.Visible;
        OpenButton.Visibility = showMap ? Visibility.Collapsed : Visibility.Visible;
        DrawPins();
    }
    private void Canvas_Changed(object sender, SizeChangedEventArgs e) => DrawPins();
    private Point Project(double lat, double lng) {
        double width = Math.Max(1, PinCanvas.ActualWidth - 48), height = Math.Max(1, PinCanvas.ActualHeight - 48);
        return new Point(24 + (lng - 121.064227) / .023554 * width, 24 + (14.762055 - lat) / .025904 * height);
    }
    private void DrawPins() {
        if (PinCanvas == null || PinCanvas.ActualWidth <= 0) return;
        PinCanvas.Children.Clear();
        var outline = new Polygon { Fill = new SolidColorBrush(Color.FromRgb(239,246,255)), Stroke = Brushes.SlateGray, StrokeThickness = 1.5, Points = new PointCollection(BarangayBoundary.Points.Select(point => Project(point.Lat, point.Lng))) };
        PinCanvas.Children.Add(outline);
        var points = visible.Select(row => (Row: row, Point: Project(row.Number("latitude"), row.Number("longitude")))).ToList();
        foreach (var item in points.OrderBy(item => item.Row.Score)) {
            var color = item.Row.Score >= high ? Brushes.Firebrick : item.Row.Score >= moderate ? Brushes.DarkOrange : Brushes.SeaGreen;
            var pin = new Button { Content = new Ellipse { Width = 14, Height = 14, Fill = color, Stroke = Brushes.White, StrokeThickness = 1.5 },
                Width = 24, Height = 24, MinHeight = 0, Padding = new Thickness(0), Margin = new Thickness(0), BorderThickness = new Thickness(0), Background = Brushes.Transparent,
                ToolTip = item.Row.Heading + "\n" + item.Row.Address };
            System.Windows.Automation.AutomationProperties.SetName(pin, item.Row.Heading + " " + item.Row.Address);
            Canvas.SetLeft(pin, item.Point.X - 12); Canvas.SetTop(pin, item.Point.Y - 12);
            pin.Click += async (_, _) => await OpenRecordsAsync(points.Where(other => Math.Abs(other.Point.X - item.Point.X) <= 12 && Math.Abs(other.Point.Y - item.Point.Y) <= 12)
                .Select(other => other.Row).OrderByDescending(row => row.Score).ThenBy(row => row.Id).ToList());
            PinCanvas.Children.Add(pin);
        }
    }
    protected override void OnClosed(EventArgs e) { api?.Dispose(); base.OnClosed(e); }
}
