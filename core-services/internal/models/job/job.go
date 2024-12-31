// The job package contains types and functions related to jobs
package job

const Table = "jobs"

// JobStatus is an enumerated type of the various states a Job can be in
type JobStatus string

const (
	Accepted           JobStatus = "accepted"
	Canceled           JobStatus = "canceled"
	CompleteWithErrors JobStatus = "complete_with_errors"
	Failed             JobStatus = "failed"
	Paused             JobStatus = "paused"
	Previewing         JobStatus = "previewing"
	Running            JobStatus = "running"
	RunningWithErrors  JobStatus = "running_with_errors"
	Successful         JobStatus = "successful"
)

var TerminalStatuses []JobStatus = []JobStatus{Canceled, CompleteWithErrors, Failed, Successful}
