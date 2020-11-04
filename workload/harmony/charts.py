import pandas as pd
import plotly.graph_objects as go


def create_bar(name, df, column='90%'):
    """
    Creates a bar graph object that can be used for constructing charts

    Arguments:
        name {String} -- The label to use for this bar graph object
        df {pandas.DataFrame} -- The dataframe to construct the bar graph from
        column {String} -- The column whose data is being graphed
        response {response.Response} -- the initial job status response

    Returns:
        {plotly.graph_objects.Bar} -- The bar graph object
    """
    return go.Bar(
        name=name,
        x=df['Name'],
        y=df[column])


def create_data_frame(filename):
    """
    Creates a pandas DataFrame from the provided CSV file containing workload performance
    numbers from a locust run. The last row in the file is ignored because the Aggregated
    performance numbers are not useful since it combines all the requests together which
    have quite different performance characteristics and can vary wildly from run to run
    depending on the percentage of fast requests such as landing page requests executed
    during the given run.

    Arguments:
        filename {String} -- The input CSV filename from which to create the DataFrame.

    Returns:
        {pandas.DataFrame} -- A DataFrame containing the CSV data.
    """
    df = pd.read_csv(filename)
    return df.drop(len(df) - 1)

def display_bar_chart(figure, title='', yaxis_title='', xaxis_title = ''):
    """
    Displays the provided figure as a grouped bar chart using the titles provided as parameters

    Arguments:
        figure {plotly.graph_objects.Figure} -- The figure to display
        title {String} -- The title for the bar chart
        yaxis_title {String} -- The title for the yaxis
        xaxis_title {String} -- The title for the xaxis
    """
    figure.update_layout(
        barmode='group',
        title=title,
        yaxis_title=yaxis_title,
        xaxis_title=xaxis_title
    )
    figure.show()
