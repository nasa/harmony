import re
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

def remove_job_status_rows(df):
    """
    Removes all of the rows representing calls to the jobs status endpoint.

    For async requests we have a row for each request that pings the job status route. This
    row is not useful for capturing performance information and when there are many async
    requests in a run this can lead to the charts having way too many values on the x axis
    and making the charts difficult to use and filled with information we do not want.

    Arguments:
        df {pandas.DataFrame} -- The dataframe to act on.
    Returns:
        {pandas.DataFrame} -- The original dataframe with all job status rows removed.
    """
    job_status_regex = re.compile(r'job status')
    jobs_rows_filter = df['Name'].str.contains(job_status_regex)
    return df[~jobs_rows_filter]


def create_data_frame(filename, drop_job_status=True, drop_aggregated=True):
    """
    Creates a pandas DataFrame from the provided CSV file containing workload performance
    numbers from a locust run.

    Optionally deletes the Aggregated row and optionally deletes and job status rows.

    The aggregated performance numbers are generally not useful since it combines all the
    requests together which have quite different performance characteristics and can vary
    wildly from run to run depending on the percentage of fast requests such as landing
    page requests executed during the given run.

    For async requests we have a row for each request that pings the job status route. This
    row is not useful for capturing performance information and when there are many async
    requests in a run this can lead to the charts having way too many values on the x axis
    and making the charts difficult to use and filled with information we do not want.

    Arguments:
        filename {String} -- The input CSV filename from which to create the DataFrame.
        drop_job_status {Boolean} -- Whether to remove the job status rows. Defaults to True.
        drop_aggregated {Boolean} -- Whether to remove the aggregated row. Defaults to True.

    Returns:
        {pandas.DataFrame} -- A DataFrame containing the CSV data with any unwanted rows
                              removed.
    """
    df = pd.read_csv(filename)
    df = df[df['Name'] != 'Set up shared session cookies']
    if (drop_aggregated):
        df = df[df['Name'] != 'Aggregated']
    if (drop_job_status):
        df = remove_job_status_rows(df)
    return df

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
