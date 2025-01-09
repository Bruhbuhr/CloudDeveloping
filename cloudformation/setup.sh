AWS_PROFILE=
PREFIX=team2-asm3
ENV=dev
KEYPAIR=team2-asm3-key
IAM_ROLE=LabRole
IAM_INSTANCE_PROFILE=LabInstanceProfile

# Compute resources
aws cloudformation create-stack \
    --stack-name $PREFIX-compute-$ENV-stack \
    --template-body file://compute-resources.yaml \
    --parameters ParameterKey=Prefix,ParameterValue=$PREFIX ParameterKey=Env,ParameterValue=$ENV ParameterKey=KeyPair,ParameterValue=$KEYPAIR ParameterKey=InstanceProfile,ParameterValue=$IAM_INSTANCE_PROFILE ParameterKey=Role,ParameterValue=$IAM_ROLE \
    --profile=$AWS_PROFILE

aws cloudformation update-stack \
    --stack-name $PREFIX-compute-$ENV-stack \
    --template-body file://compute-resources.yaml \
    --parameters ParameterKey=Prefix,ParameterValue=$PREFIX ParameterKey=Env,ParameterValue=$ENV ParameterKey=KeyPair,ParameterValue=$KEYPAIR ParameterKey=InstanceProfile,ParameterValue=$IAM_INSTANCE_PROFILE ParameterKey=Role,ParameterValue=$IAM_ROLE \
    --profile=$AWS_PROFILE

# Serverless resources
aws cloudformation create-stack \
    --stack-name $PREFIX-serverless-$ENV-stack \
    --template-body file://serverless-resources.yaml \
    --parameters ParameterKey=Prefix,ParameterValue=$PREFIX ParameterKey=Env,ParameterValue=$ENV ParameterKey=Role,ParameterValue=$IAM_ROLE \
    --profile=$AWS_PROFILE

aws cloudformation update-stack \
    --stack-name $PREFIX-serverless-$ENV-stack \
    --template-body file://serverless-resources.yaml \
    --parameters ParameterKey=Prefix,ParameterValue=$PREFIX ParameterKey=Env,ParameterValue=$ENV ParameterKey=Role,ParameterValue=$IAM_ROLE \
    --profile=$AWS_PROFILE

# Clean resources
aws cloudformation delete-stack \
    --stack-name $PREFIX-compute-$ENV-stack \
    --profile=$AWS_PROFILE

aws cloudformation delete-stack \
    --stack-name $PREFIX-serverless-$ENV-stack \
    --profile=$AWS_PROFILE
